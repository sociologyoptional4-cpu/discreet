#!/usr/bin/env bash
# Two real sessions racing: (1) a send against a block, (2) two simultaneous accepts.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres tests/concurrency.sh
set -uo pipefail
cd "$(dirname "$0")/.."
A=11111111-1111-1111-1111-111111111111; B=22222222-2222-2222-2222-222222222222
psql -q -c "drop database if exists nc_conc" -c "create database nc_conc"
for f in tests/shim.sql migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d nc_conc -f "$f"; done
as() { echo "set role authenticated; select set_config('request.jwt.claim.sub','$1',false);"; }
psql -q -d nc_conc <<SQL
insert into auth.users (id,email) values ('$A','a@x.test'),('$B','b@x.test');
insert into public.profiles (id,display_name,city_id) values ('$A','A',1),('$B','B',1);
insert into public.account_private (user_id,dob) values ('$A','1990-01-01'),('$B','1990-01-01');
insert into public.chat_requests (from_id,to_id,note) values ('$A','$B','hi');
SQL
REQ=$(psql -At -d nc_conc -c "select id from public.chat_requests")
# --- simultaneous accept: both sessions accept at once, then sleep inside the first txn to force overlap
( { as $B; echo "begin; select public.respond_to_request('$REQ', true); select pg_sleep(1.5); commit;"; } | psql -At -d nc_conc > /tmp/nc_acc1.txt 2>&1 ) &
sleep 0.4
( { as $B; echo "select public.respond_to_request('$REQ', true);"; } | psql -At -d nc_conc > /tmp/nc_acc2.txt 2>&1 ) &
wait
# The accept result is the last uuid line (the first is the set_config echo).
C1=$(grep -E '^[0-9a-f-]{36}$' /tmp/nc_acc1.txt | tail -1); C2=$(grep -E '^[0-9a-f-]{36}$' /tmp/nc_acc2.txt | tail -1)
N=$(psql -At -d nc_conc -c "select count(*) from public.conversations")
REAL=$(psql -At -d nc_conc -c "select id from public.conversations limit 1")
[ -n "$C1" ] && [ "$C1" = "$C2" ] && [ "$C1" = "$REAL" ] && [ "$N" = 1 ] && echo "PASS simultaneous accept: one conversation ($N), both callers got the same id" || { echo "FAIL simultaneous accept: $C1 / $C2 / count=$N"; cat /tmp/nc_acc1.txt /tmp/nc_acc2.txt; }
CONV=$C1
# --- send vs block: B starts blocking (holds the pair lock), A tries to send meanwhile
( { as $B; echo "begin; select public.block_user('$A'); select pg_sleep(1.5); commit;"; } | psql -At -d nc_conc > /tmp/nc_blk.txt 2>&1 ) &
sleep 0.5
( { as $A; echo "select * from public.send_message('$CONV', gen_random_uuid(), 'racing the block');"; } | psql -At -d nc_conc > /tmp/nc_send.txt 2>&1 ) &
wait
M=$(psql -At -d nc_conc -c "select count(*) from public.messages where body = 'racing the block'")
if [ "$M" = 0 ] && grep -q conversation_unavailable /tmp/nc_send.txt; then echo "PASS send after a committed block fails (waited for the lock, then rejected; 0 rows saved)"; else echo "FAIL send vs block: rows=$M"; cat /tmp/nc_send.txt; fi
