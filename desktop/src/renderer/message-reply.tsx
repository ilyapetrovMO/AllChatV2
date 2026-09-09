import type { Message } from "../shared/instance-state";

export function replySummary(message: Pick<Message, "body" | "deleted" | "attachments">): string {
  if (message.deleted) return "Message deleted";
  return message.body?.replace(/\s+/g, " ").trim() || message.attachments?.map(file => file.name).join(", ") || "Attachment";
}

export function ReplyComposerPreview({ message, onCancel }: { message: Message; onCancel(): void }) {
  const summary = replySummary(message);
  return <div className="reply-composer-preview">
    <div><strong>Replying to {message.author_name}</strong><span title={summary}>{summary}</span></div>
    <button type="button" aria-label="Cancel reply" title="Cancel reply" onClick={onCancel}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
    </button>
  </div>;
}

export function ReplyExcerpt({ reply }: { reply: NonNullable<Message["reply"]> }) {
  const summary = reply.deleted ? "Message deleted" : reply.body?.replace(/\s+/g, " ").trim() || "Attachment";
  return <div className="message-reply-excerpt">
    <svg className="reply-connector" width="24" height="20" viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 18v-7a6 6 0 0 1 6-6h12m-4-4 4 4-4 4" /></svg>
    <strong>{reply.author_name}</strong><span title={summary}>{summary}</span>
  </div>;
}
