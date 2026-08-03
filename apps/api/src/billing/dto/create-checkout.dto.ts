import { IsIn } from 'class-validator';
import { Plan } from '@shorts/db';

// Enterprise excluded — §13.1: "Custom" pricing is sales-assisted, not
// self-serve Checkout. BillingService.createCheckoutSession() also
// re-validates this server-side; the DTO is the first line of defense.
export class CreateCheckoutDto {
  @IsIn([Plan.STARTER, Plan.CREATOR, Plan.AGENCY])
  plan!: 'STARTER' | 'CREATOR' | 'AGENCY';
}
