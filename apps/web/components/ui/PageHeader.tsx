type PageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
};

export function PageHeader({ title, description, eyebrow }: PageHeaderProps) {
  return (
    <header className="page-header">
      {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
      <h1 className="page-title">{title}</h1>
      {description && <p className="page-description">{description}</p>}
    </header>
  );
}
