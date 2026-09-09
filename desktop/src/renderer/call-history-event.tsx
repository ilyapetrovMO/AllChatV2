import type { Message } from "../shared/instance-state";
import type { DirectCall } from "../shared/instance-actions";

export function callHistoryLabel(call: DirectCall, currentMemberId: string, otherName: string): string {
  const caller = call.caller_id === currentMemberId;
  switch (call.state) {
    case "ringing": return caller ? `You called ${otherName}` : `Incoming call from ${otherName}`;
    case "accepted": return caller ? `${otherName} accepted the call` : "You accepted the call";
    case "missed": return caller ? `No answer from ${otherName}` : `Missed call from ${otherName}`;
    case "declined": return caller ? `${otherName} declined the call` : "You declined the call";
    default: {
      if (!call.accepted_at) return "Call cancelled";
      const duration = Math.floor((Date.parse(call.finished_at ?? "") - Date.parse(call.accepted_at)) / 1000);
      if (!Number.isFinite(duration) || duration < 0) return "Call finished";
      const hours = Math.floor(duration / 3600);
      const minutes = Math.floor((duration % 3600) / 60);
      const seconds = duration % 60;
      return `Call finished · ${hours ? `${hours}h ` : ""}${minutes ? `${minutes}m ` : ""}${seconds}s`;
    }
  }
}

export function CallHistoryEvent({ message, currentMemberId, otherName }: { message: Message; currentMemberId: string; otherName: string }) {
  const call = message.call_event;
  if (!call) return null;
  const tone = call.state === "accepted" ? "accepted" : ["missed", "declined"].includes(call.state) ? "unanswered" : "neutral";
  const time = new Date(message.created_at);
  return <article className={`call-history-event ${tone}`} id={`message-${message.id}`}>
    <time dateTime={message.created_at} title={time.toLocaleString()}>{time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
    <div className="call-history-divider">
      <span className="call-history-label">
        <svg className="call-history-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.2 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.79a2 2 0 0 1-.45 2.11L8.09 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.34 1.83.58 2.79.7A2 2 0 0 1 22 16.92z" /></svg>
        <span>{callHistoryLabel(call, currentMemberId, otherName)}</span>
      </span>
    </div>
  </article>;
}
