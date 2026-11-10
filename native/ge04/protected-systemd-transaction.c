/* GE-04 Phase 3: native protected systemd transaction SOURCE CANDIDATE.
 *
 * SECURITY HOLD ACTIVE. No privileged entrypoint invokes this file.
 * This opens a private system-bus connection and subscribes for the original
 * manager's JobRemoved before any future exclusive creation request.
 * It NEVER calls StartTransientUnit. No approval or native ACK is issued.
 */
#define _GNU_SOURCE
#include "protected-systemd-transaction.h"
#include <errno.h>
#include <stdint.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

#define GE04_BUS_SOCKET "unix:path=/run/dbus/system_bus_socket"
#define GE04_MANAGER "org.freedesktop.systemd1"
#define GE04_MANAGER_PATH "/org/freedesktop/systemd1"
#define GE04_MANAGER_IFACE "org.freedesktop.systemd1.Manager"
#define GE04_TIMEOUT_US UINT64_C(1000000)

static int deny(int value) { errno = value; return -1; }
static int root_identity(void) {
    return getuid() == 0 && geteuid() == 0 &&
           getgid() == 0 && getegid() == 0;
}
static int unique_owner(const char *name) {
    if (!name || name[0] != ':' || name[1] < '0' || name[1] > '9')
        return 0;
    size_t i = 1;
    while (name[i] >= '0' && name[i] <= '9') ++i;
    if (name[i++] != '.' || name[i] < '0' || name[i] > '9')
        return 0;
    while (name[i] >= '0' && name[i] <= '9') ++i;
    return name[i] == 0 && i < 64;
}
static int current_root_manager(sd_bus *bus, const char *expected) {
    sd_bus_creds *credentials = NULL;
    const char *owner = NULL;
    uid_t uid;
    int r = sd_bus_get_name_creds(
        bus, GE04_MANAGER,
        SD_BUS_CREDS_UNIQUE_NAME | SD_BUS_CREDS_EUID, &credentials);
    if (r < 0) return deny(EPERM);
    r = sd_bus_creds_get_unique_name(credentials, &owner);
    if (r < 0 || !unique_owner(owner) ||
        (expected && strcmp(expected, owner) != 0) ||
        sd_bus_creds_get_euid(credentials, &uid) < 0 ||
        uid != (uid_t)0) {
        sd_bus_creds_unref(credentials);
        return deny(EPERM);
    }
    sd_bus_creds_unref(credentials);
    return 0;
}

void ge04_systemd_transaction_init(struct ge04_systemd_transaction *tx) {
    if (!tx) return;
    tx->bus = NULL;
    tx->job_slot = NULL;
    tx->owner[0] = 0;
    tx->subscribed = 0;
    tx->poisoned = 0;
}

void ge04_systemd_transaction_close(struct ge04_systemd_transaction *tx) {
    if (!tx) return;
    int prior_poison = tx->poisoned;
    if (tx->subscribed && tx->bus && unique_owner(tx->owner)) {
        /* This is a private connection. Best effort; close releases it.
         * The bounded process supervisor will ultimately be required.
         */
        sd_bus_call_method(tx->bus, tx->owner, GE04_MANAGER_PATH,
                           GE04_MANAGER_IFACE, "Unsubscribe",
                           NULL, NULL, "");
    }
    sd_bus_slot_unref(tx->job_slot);
    sd_bus_close_unref(tx->bus);
    ge04_systemd_transaction_init(tx);
    tx->poisoned = prior_poison;
}

/* This component has NO issued job. A JobRemoved for the fixed unit before
 * a reviewed creation transaction is unexpected and poisons the attempt.
 */
static int job_event(sd_bus_message *message, void *userdata,
                     sd_bus_error *error) {
    (void)error;
    struct ge04_systemd_transaction *tx = userdata;
    uint32_t id;
    const char *path = NULL, *unit = NULL, *result = NULL;
    int r = sd_bus_message_read(message, "uoss", &id, &path, &unit, &result);
    (void)id;
    (void)path;
    (void)result;
    if (!tx || r < 0 || !unit) {
        if (tx) tx->poisoned = 1;
        return 0;
    }
    if (strcmp(unit, GE04_PREBIRTH_UNIT) == 0)
        tx->poisoned = 1;
    return 0;
}

/* Dispatch only already-queued messages; never wait for a new event.
 * Every callback can revoke authority but cannot grant it. A queue flood,
 * dispatch failure, or suspicious fixed-unit event is a terminal refusal.
 * This DOES NOT establish no in-flight signals or linearizable absence.
 */
static int drain_pending(struct ge04_systemd_transaction *tx) {
    for (unsigned i = 0; i < 64; ++i) {
        int r = sd_bus_process(tx->bus, NULL);
        if (r < 0 || tx->poisoned) {
            tx->poisoned = 1;
            return deny(EPERM);
        }
        if (r == 0) return 0;
    }
    tx->poisoned = 1;
    return deny(EPERM);
}

int ge04_systemd_recheck_original(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx) {
    if (!root_identity() || !tx || !tx->bus || !tx->job_slot ||
        tx->poisoned || !tx->subscribed || !unique_owner(tx->owner))
        return deny(EPERM);
    if (ge04_attempt_recheck(claim, attempt) != 0 ||
        ge04_prebirth_recheck(claim, journal) != 0 ||
        drain_pending(tx) != 0 ||
        current_root_manager(tx->bus, tx->owner) != 0 ||
        drain_pending(tx) != 0) {
        tx->poisoned = 1;
        return deny(EPERM);
    }
    return 0;
}

int ge04_systemd_subscribe_original(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx) {
    if (!root_identity()) return deny(EPERM);
    if (!claim || !attempt || !journal || !tx ||
        tx->bus || tx->job_slot || tx->owner[0] ||
        tx->subscribed || tx->poisoned)
        return deny(EINVAL);
    if (ge04_attempt_recheck(claim, attempt) != 0 ||
        ge04_prebirth_recheck(claim, journal) != 0)
        return deny(EPERM);

    sd_bus *bus = NULL;
    sd_bus_slot *slot = NULL;
    sd_bus_creds *credentials = NULL;
    const char *owner = NULL;
    uid_t uid;
    int r = sd_bus_new(&bus);
    if (r < 0) goto failed;
    r = sd_bus_set_address(bus, GE04_BUS_SOCKET);
    if (r < 0) goto failed;
    r = sd_bus_set_bus_client(bus, 1);
    if (r < 0) goto failed;
    r = sd_bus_set_method_call_timeout(bus, GE04_TIMEOUT_US);
    if (r < 0) goto failed;
    r = sd_bus_start(bus);
    if (r < 0) goto failed;
    r = sd_bus_get_name_creds(
        bus, GE04_MANAGER,
        SD_BUS_CREDS_UNIQUE_NAME | SD_BUS_CREDS_EUID, &credentials);
    if (r < 0) goto failed;
    r = sd_bus_creds_get_unique_name(credentials, &owner);
    if (r < 0 || !unique_owner(owner) ||
        sd_bus_creds_get_euid(credentials, &uid) < 0 ||
        uid != (uid_t)0) goto failed;
    size_t len = strlen(owner);
    memcpy(tx->owner, owner, len + 1);
    sd_bus_creds_unref(credentials);
    credentials = NULL;

    /* Install match before Subscribe, and before any creation request.
     * This source deliberately never sends StartTransientUnit.
     */
    r = sd_bus_match_signal(bus, &slot, tx->owner, GE04_MANAGER_PATH,
                            GE04_MANAGER_IFACE, "JobRemoved",
                            job_event, tx);
    if (r < 0) goto failed;
    r = sd_bus_call_method(bus, tx->owner, GE04_MANAGER_PATH,
                           GE04_MANAGER_IFACE, "Subscribe",
                           NULL, NULL, "");
    if (r < 0) goto failed;
    tx->bus = bus;
    tx->job_slot = slot;
    tx->subscribed = 1;
    if (ge04_systemd_recheck_original(claim, attempt, journal, tx) != 0) {
        tx->poisoned = 1;
        ge04_systemd_transaction_close(tx);
        return deny(EPERM);
    }
    return 0;

failed:
    sd_bus_creds_unref(credentials);
    sd_bus_slot_unref(slot);
    sd_bus_close_unref(bus);
    tx->poisoned = 1;
    return deny(EPERM);
}

int ge04_systemd_create_exclusive(struct ge04_systemd_transaction *tx) {
    if (tx) tx->poisoned = 1;
    return deny(EPERM); /* SECURITY HOLD: no StartTransientUnit */
}
