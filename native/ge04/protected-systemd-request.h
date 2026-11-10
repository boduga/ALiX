#ifndef GE04_PROTECTED_SYSTEMD_REQUEST_H
#define GE04_PROTECTED_SYSTEMD_REQUEST_H
#include <systemd/sd-bus.h>

/* REVIEW CANDIDATE ONLY. No caller dispatches this message. */
#define GE04_KEEPER_CANDIDATE "/usr/libexec/alix/ge04-qualification-keeper"

/* Append the fixed StartTransientUnit payload ONLY to a caller-owned method
 * message. The sender, exact D-Bus cookie, original issuer custody and unit
 * birth are separately required and NOT implemented here.
 * This source never calls sd_bus_send, sd_bus_call or StartTransientUnit.
 */
int ge04_append_fixed_transient_request(sd_bus_message *message);
#endif
