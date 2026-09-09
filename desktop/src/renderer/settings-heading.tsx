export function SettingsHeading({ title, description, community = false }: { title: string; description: string; community?: boolean }) {
  return <header className="settings-heading"><p className="eyebrow">{community ? "Community settings" : "Member settings"}</p><h2>{title}</h2><p>{description}</p></header>;
}
