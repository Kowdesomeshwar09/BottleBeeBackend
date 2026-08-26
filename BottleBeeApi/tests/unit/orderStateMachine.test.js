'use strict';

const machine = require('../../utils/orderStateMachine');
const { ORDER_STATUS, DELIVERY_ASSIGNMENT_STATUS, ROLES } = require('../../config/constants');
const AppError = require('../../utils/AppError');

/**
 * The order state machine.
 *
 * This is what stops an order being marked delivered before it was ever picked
 * up, or a customer moving their own order to CONFIRMED to skip payment. The
 * graph and the role table are the only authority; every endpoint routes through
 * `assertOrderTransition`.
 */
describe('order state machine', () => {
  describe('isValidOrderTransition', () => {
    it('permits the normal fulfilment path', () => {
      const path = [
        [ORDER_STATUS.PLACED, ORDER_STATUS.PAYMENT_PENDING],
        [ORDER_STATUS.PAYMENT_PENDING, ORDER_STATUS.CONFIRMED],
        [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING],
        [ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP],
        [ORDER_STATUS.READY_FOR_PICKUP, ORDER_STATUS.ASSIGNED],
        [ORDER_STATUS.ASSIGNED, ORDER_STATUS.PICKED_UP],
        [ORDER_STATUS.PICKED_UP, ORDER_STATUS.OUT_FOR_DELIVERY],
        [ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED],
      ];

      path.forEach(([from, to]) => {
        expect(machine.isValidOrderTransition(from, to)).toBe(true);
      });
    });

    it('refuses a jump that skips fulfilment', () => {
      expect(machine.isValidOrderTransition(ORDER_STATUS.PLACED, ORDER_STATUS.DELIVERED)).toBe(false);
      expect(
        machine.isValidOrderTransition(ORDER_STATUS.READY_FOR_PICKUP, ORDER_STATUS.DELIVERED)
      ).toBe(false);
      expect(machine.isValidOrderTransition(ORDER_STATUS.CONFIRMED, ORDER_STATUS.PICKED_UP)).toBe(false);
    });

    it('refuses moving backwards', () => {
      expect(machine.isValidOrderTransition(ORDER_STATUS.DELIVERED, ORDER_STATUS.PREPARING)).toBe(false);
      expect(machine.isValidOrderTransition(ORDER_STATUS.PREPARING, ORDER_STATUS.CONFIRMED)).toBe(false);
    });

    it('treats REFUNDED as terminal', () => {
      expect(machine.allowedNextOrderStatuses(ORDER_STATUS.REFUNDED)).toEqual([]);
    });

    it('allows refund only from DELIVERED or CANCELLED', () => {
      expect(machine.isValidOrderTransition(ORDER_STATUS.DELIVERED, ORDER_STATUS.REFUNDED)).toBe(true);
      expect(machine.isValidOrderTransition(ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED)).toBe(true);
      expect(machine.isValidOrderTransition(ORDER_STATUS.PREPARING, ORDER_STATUS.REFUNDED)).toBe(false);
    });

    it('allows cancellation at every pre-delivery stage but not after', () => {
      const cancellable = [
        ORDER_STATUS.PLACED, ORDER_STATUS.PAYMENT_PENDING, ORDER_STATUS.PAYMENT_FAILED,
        ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP,
        ORDER_STATUS.ASSIGNED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.OUT_FOR_DELIVERY,
      ];

      cancellable.forEach((from) => {
        expect(machine.isValidOrderTransition(from, ORDER_STATUS.CANCELLED)).toBe(true);
      });

      expect(machine.isValidOrderTransition(ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED)).toBe(false);
    });
  });

  describe('assertOrderTransition', () => {
    it('rejects a transition to the status it is already in', () => {
      expect(() => machine.assertOrderTransition(
        ORDER_STATUS.PREPARING, ORDER_STATUS.PREPARING, [ROLES.ADMIN]
      )).toThrow(/already in status/i);
    });

    it('reports what is allowed when refusing', () => {
      try {
        machine.assertOrderTransition(
          ORDER_STATUS.READY_FOR_PICKUP, ORDER_STATUS.DELIVERED, [ROLES.SUPER_ADMIN]
        );
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.errors[0].allowed).toContain(ORDER_STATUS.ASSIGNED);
        expect(err.errors[0].allowed).toContain(ORDER_STATUS.CANCELLED);
      }
    });

    it('lets a vendor prepare an order', () => {
      expect(() => machine.assertOrderTransition(
        ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, [ROLES.VENDOR_OWNER]
      )).not.toThrow();
    });

    it('stops a customer driving fulfilment', () => {
      // A customer moving their own order to PREPARING would let them bypass
      // the store entirely.
      expect(() => machine.assertOrderTransition(
        ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, [ROLES.CUSTOMER]
      )).toThrow(/may not move an order/i);
    });

    it('stops a vendor marking an order delivered', () => {
      // Only the delivery partner at the door, or an admin, can attest delivery.
      expect(() => machine.assertOrderTransition(
        ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED, [ROLES.VENDOR_OWNER]
      )).toThrow(/may not move an order/i);
    });

    it('lets a delivery partner complete a delivery', () => {
      expect(() => machine.assertOrderTransition(
        ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED, [ROLES.DELIVERY_PARTNER]
      )).not.toThrow();
    });

    it('lets a customer cancel', () => {
      expect(() => machine.assertOrderTransition(
        ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED, [ROLES.CUSTOMER]
      )).not.toThrow();
    });
  });

  describe('assertCustomerMayCancel', () => {
    it('allows cancellation before the store starts preparing', () => {
      [ORDER_STATUS.PLACED, ORDER_STATUS.PAYMENT_PENDING, ORDER_STATUS.CONFIRMED]
        .forEach((status) => {
          expect(() => machine.assertCustomerMayCancel(status)).not.toThrow();
        });
    });

    it('refuses once the store has started work', () => {
      [ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP, ORDER_STATUS.OUT_FOR_DELIVERY]
        .forEach((status) => {
          expect(() => machine.assertCustomerMayCancel(status)).toThrow(/no longer be cancelled/i);
        });
    });
  });

  describe('holdsReservation', () => {
    it('is true for every stage that holds stock', () => {
      [ORDER_STATUS.PLACED, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING,
        ORDER_STATUS.ASSIGNED, ORDER_STATUS.OUT_FOR_DELIVERY]
        .forEach((status) => expect(machine.holdsReservation(status)).toBe(true));
    });

    it('is false once the order is finished', () => {
      // Releasing again after delivery or cancellation would invent stock.
      [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED]
        .forEach((status) => expect(machine.holdsReservation(status)).toBe(false));
    });
  });

  describe('delivery transitions', () => {
    it('permits the normal rider path', () => {
      const path = [
        [DELIVERY_ASSIGNMENT_STATUS.ASSIGNED, DELIVERY_ASSIGNMENT_STATUS.ACCEPTED],
        [DELIVERY_ASSIGNMENT_STATUS.ACCEPTED, DELIVERY_ASSIGNMENT_STATUS.PICKED_UP],
        [DELIVERY_ASSIGNMENT_STATUS.PICKED_UP, DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT],
        [DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT, DELIVERY_ASSIGNMENT_STATUS.DELIVERED],
      ];

      path.forEach(([from, to]) => {
        expect(machine.isValidDeliveryTransition(from, to)).toBe(true);
      });
    });

    it('refuses delivering something never picked up', () => {
      expect(machine.isValidDeliveryTransition(
        DELIVERY_ASSIGNMENT_STATUS.ASSIGNED, DELIVERY_ASSIGNMENT_STATUS.DELIVERED
      )).toBe(false);
    });

    it('treats rejection and delivery as terminal', () => {
      expect(machine.isValidDeliveryTransition(
        DELIVERY_ASSIGNMENT_STATUS.REJECTED, DELIVERY_ASSIGNMENT_STATUS.ACCEPTED
      )).toBe(false);
      expect(machine.isValidDeliveryTransition(
        DELIVERY_ASSIGNMENT_STATUS.DELIVERED, DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT
      )).toBe(false);
    });

    it('maps each delivery step onto the order status it implies', () => {
      expect(machine.DELIVERY_TO_ORDER_STATUS[DELIVERY_ASSIGNMENT_STATUS.PICKED_UP])
        .toBe(ORDER_STATUS.PICKED_UP);
      expect(machine.DELIVERY_TO_ORDER_STATUS[DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT])
        .toBe(ORDER_STATUS.OUT_FOR_DELIVERY);
      expect(machine.DELIVERY_TO_ORDER_STATUS[DELIVERY_ASSIGNMENT_STATUS.DELIVERED])
        .toBe(ORDER_STATUS.DELIVERED);
    });
  });
});
