import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CallHistoryEvent, callHistoryLabel } from "./call-history-event";
import type { DirectCall } from "../shared/instance-actions";
const call: DirectCall = { id: "call", direct_message_id: "dm", caller_id: "sam", recipient_id: "me", state: "ringing", created_at: "2026-09-09T10:25:00Z" };
describe("DM call history", () => {
 it("describes both participants' perspectives", () => {
  for (const [state, recipient, caller] of [
   ["ringing", "Incoming call from sam", "You called Alex"],
   ["accepted", "You accepted the call", "Alex accepted the call"],
   ["missed", "Missed call from sam", "No answer from Alex"],
   ["declined", "You declined the call", "Alex declined the call"],
  ]) {
   expect(callHistoryLabel({...call,state}, "me", "sam")).toBe(recipient);
   expect(callHistoryLabel({...call,state}, "sam", "Alex")).toBe(caller);
  }
 });
 it("measures duration from acceptance and distinguishes cancelled ringing calls", () => {
  expect(callHistoryLabel({...call,state:"ended",accepted_at:"2026-09-09T10:25:05Z",finished_at:"2026-09-09T10:37:39Z"},"me","sam")).toBe("Call finished · 12m 34s");
  expect(callHistoryLabel({...call,state:"ended"},"me","sam")).toBe("Call cancelled");
 });
 it("renders an event with a semantic timestamp and no ordinary message actions", () => {
  const {container}=render(<CallHistoryEvent message={{id:"event",channel_id:"dm",author_id:"sam",author_name:"sam",sequence:1,created_at:call.created_at,deleted:false,call_event:call}} currentMemberId="me" otherName="sam"/>);
  expect(screen.getByText("Incoming call from sam")).toBeVisible();
  expect(container.querySelector('time')).toHaveAttribute('datetime',call.created_at);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
 });
});
