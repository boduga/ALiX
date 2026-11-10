/* GE-04 phase 3B2 fixed payload serializer. This file NEVER sends a
 * request. No installed keeper, reviewed executable or root admission.
 */
#include "protected-systemd-request.h"
#include "protected-prebirth-journal.h"
#include <errno.h>
#include <stdbool.h>

static int field(sd_bus_message *m, const char *name, const char *type,
                 const char *string_value, int boolean_value) {
    int r = sd_bus_message_open_container(m, 'r', "sv");
    if (r < 0) return r;
    r = sd_bus_message_append(m, "s", name);
    if (r < 0) return r;
    r = sd_bus_message_open_container(m, 'v', type);
    if (r < 0) return r;
    if (type[0] == 's')
        r = sd_bus_message_append(m, "s", string_value);
    else
        r = sd_bus_message_append(m, "b", boolean_value);
    if (r < 0) return r;
    r = sd_bus_message_close_container(m);
    if (r < 0) return r;
    return sd_bus_message_close_container(m);
}

static int exec_start(sd_bus_message *m) {
    int r = sd_bus_message_open_container(m, 'r', "sv");
    if (r < 0) return r;
    r = sd_bus_message_append(m, "s", "ExecStart");
    if (r < 0) return r;
    r = sd_bus_message_open_container(m, 'v', "a(sasb)");
    if (r < 0) return r;
    r = sd_bus_message_open_container(m, 'a', "(sasb)");
    if (r < 0) return r;
    r = sd_bus_message_open_container(m, 'r', "sasb");
    if (r < 0) return r;
    r = sd_bus_message_append(m, "s", GE04_KEEPER_CANDIDATE);
    if (r < 0) return r;
    r = sd_bus_message_open_container(m, 'a', "s");
    if (r < 0) return r;
    r = sd_bus_message_append(m, "s", GE04_KEEPER_CANDIDATE);
    if (r < 0) return r;
    r = sd_bus_message_close_container(m);
    if (r < 0) return r;
    r = sd_bus_message_append(m, "b", 0); /* ignore_failure=false */
    if (r < 0) return r;
    r = sd_bus_message_close_container(m);
    if (r < 0) return r;
    r = sd_bus_message_close_container(m);
    if (r < 0) return r;
    r = sd_bus_message_close_container(m);
    if (r < 0) return r;
    return sd_bus_message_close_container(m);
}

int ge04_append_fixed_transient_request(sd_bus_message *m) {
    if (!m) { errno = EINVAL; return -1; }
    /* Exact method signature: ss a(sv) a(sa(sv)). Mode fail refuses an
     * existing unit name, but is not itself proof of exclusive birth.
     */
    int r = sd_bus_message_append(m, "ss", GE04_PREBIRTH_UNIT, "fail");
    if (r < 0) return r;
    r = sd_bus_message_open_container(m, 'a', "(sv)");
    if (r < 0) return r;
    r = field(m, "Description", "s", "ALiX GE-04 qualification keeper", 0);
    if (r < 0) return r;
    r = field(m, "Type", "s", "exec", 0);
    if (r < 0) return r;
    r = field(m, "NoNewPrivileges", "b", NULL, 1);
    if (r < 0) return r;
    r = field(m, "Delegate", "b", NULL, 1);
    if (r < 0) return r;
    r = exec_start(m);
    if (r < 0) return r;
    r = sd_bus_message_close_container(m);
    if (r < 0) return r;
    r = sd_bus_message_open_container(m, 'a', "(sa(sv))");
    if (r < 0) return r;
    return sd_bus_message_close_container(m); /* no auxiliary units */
}
