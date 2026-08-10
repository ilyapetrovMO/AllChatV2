# 16 — Place consent-based Direct Calls

**What to build:** A Member can ring the other participant in a Direct Message and establish a private audio Media Session only after explicit acceptance, without disrupting an existing Media Session.

**Blocked by:** 13 — Exchange Direct Messages and enforce Blocks; 15 — Join a live Voice Room

**Status:** resolved

- [x] An unblocked participant can initiate a ringing Direct Call from the Direct Message.
- [x] The recipient may accept or decline before any microphone media is connected.
- [x] Ringing expires after a bounded timeout and produces an appropriate missed-call event.
- [x] A Member already in a Media Session remains there and the incoming attempt becomes busy/missed.
- [x] Only the two Direct Message participants can observe signaling or join the Direct Call.
- [x] Ending, declining, blocking, suspending, disconnecting, and restarting produce consistent call state.
- [x] Direct Call behavior is verified with real WebRTC peers through the public Instance seam.

## Answer

Implemented 30-second consent-based DM ringing, accept/decline/end and missed states, busy isolation, two-participant authorization, block/policy teardown, and the shared authenticated WebRTC signaling seam. Microphone capture begins only after acceptance.
