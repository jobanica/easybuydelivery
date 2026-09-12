/**
 * Domain types shared across all frontends. These mirror the Supabase schema
 * enums (see supabase/migrations). Table row types can be generated with the
 * Supabase CLI once the project is linked; these are the hand-authored unions.
 */

export type ServiceType = 'food' | 'pabili' | 'padala';

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'picked_up'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled';

export type PaymentMethod = 'cod' | 'online' | 'rider_qr';
export type PaymentStatus = 'unpaid' | 'paid';
export type FeePayer = 'sender' | 'receiver';
export type RiderApplicationStatus = 'pending' | 'approved' | 'rejected';
export type SettlementStatus = 'pending' | 'confirmed';
export type DeliveryFeeModel = 'flat' | 'per_km' | 'per_zone';
export type UserRole = 'customer' | 'rider' | 'admin';

/** Forward order-status transitions allowed in the happy path, by service. */
export const ORDER_FLOW: Record<ServiceType, OrderStatus[]> = {
  food: ['pending', 'accepted', 'preparing', 'picked_up', 'on_the_way', 'delivered'],
  pabili: ['pending', 'accepted', 'preparing', 'picked_up', 'on_the_way', 'delivered'],
  // No store prep step for point-to-point courier.
  padala: ['pending', 'accepted', 'picked_up', 'on_the_way', 'delivered'],
};

/**
 * What an order's status means to the customer, in words rather than in the
 * enum's vocabulary.
 *
 * Who is carrying it changes what the same word means. "Pending" on a rider
 * order means nobody has taken it yet; on a collection it means the shop hasn't
 * confirmed. "Delivered" on a collection means you came and got it. Showing the
 * raw status made an order assigned to the operator's own van read as though
 * nothing had happened to it.
 */
export function orderStatusLabel(
  status: string,
  carrier?: { kind: 'pickup' | 'in_house'; name?: string | null } | null,
): string {
  if (carrier?.kind === 'pickup') {
    switch (status) {
      case 'pending': return 'Waiting for the shop to confirm';
      case 'accepted': return 'Confirmed — we’ll tell you when it’s ready';
      case 'preparing': return 'Being prepared';
      case 'delivered': return 'Collected';
      case 'cancelled': return 'Cancelled';
      default: return status.replaceAll('_', ' ');
    }
  }
  const who = carrier?.name || 'our vehicle';
  if (carrier?.kind === 'in_house') {
    switch (status) {
      case 'accepted': return `Confirmed — assigned to ${who}`;
      case 'preparing': return 'Being prepared';
      case 'picked_up': return `${who} has your order`;
      case 'on_the_way': return `${who} is on the way`;
      case 'delivered': return 'Delivered';
      case 'cancelled': return 'Cancelled';
      default: return status.replaceAll('_', ' ');
    }
  }
  switch (status) {
    case 'pending': return 'Looking for a rider';
    case 'accepted': return 'Rider assigned';
    case 'preparing': return 'Being prepared';
    case 'picked_up': return 'Picked up';
    case 'on_the_way': return 'On the way';
    case 'delivered': return 'Delivered';
    case 'cancelled': return 'Cancelled';
    default: return status.replaceAll('_', ' ');
  }
}

/** Is `next` a valid forward transition from `current` for this service? */
export function canTransition(
  service: ServiceType,
  current: OrderStatus,
  next: OrderStatus,
): boolean {
  if (next === 'cancelled') return current !== 'delivered';
  const flow = ORDER_FLOW[service];
  const i = flow.indexOf(current);
  const j = flow.indexOf(next);
  return i !== -1 && j === i + 1;
}
