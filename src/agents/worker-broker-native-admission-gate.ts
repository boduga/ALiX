/** GE-04 Q3.31: fail-closed native diagnostic-to-governance boundary.
 * The Q3.25–Q3.30 native stdout frame is NOT an authenticated transport.
 * Do not convert its parsed peer into a VerifiedBrokerPeer for admission.
 */
import type {NativePeerHandoff} from './worker-broker-native-handoff.js';
import type {BrokerAuthorizationTicket} from './worker-broker-authorization.js';

/** Explicitly reject all diagnostic handoffs until a broker-owned authenticated
 * channel and authoritative live PID/attempt mapping are implemented. */
export async function admitNativeDiagnosticHandoff(
  _handoff:NativePeerHandoff,
  _ticket:BrokerAuthorizationTicket,
  _provider:string,
):Promise<never> {
  throw new Error('GE-04 SECURITY HOLD: native diagnostic stdout is not authenticated admission evidence');
}
