export function HeroMockup() {
  const steps = [
    { label: '采数', status: 'done' as const },
    { label: '撰写', status: 'active' as const },
    { label: '质检', status: 'pending' as const },
  ];

  return (
    <div className="hero-mockup">
      <div className="hero-mockup__chrome">
        <span className="hero-mockup__dot" />
        <span className="hero-mockup__dot" />
        <span className="hero-mockup__dot" />
        <span className="hero-mockup__title">600519 · 贵州茅台</span>
      </div>
      <div className="hero-mockup__body">
        <div className="hero-mockup__pipeline">
          {steps.map((s) => (
            <div
              key={s.label}
              className={`hero-mockup__step hero-mockup__step--${s.status}`}
            >
              <span className="hero-mockup__step-dot" />
              {s.label}
            </div>
          ))}
        </div>
        <div className="hero-mockup__panel">
          <div className="hero-mockup__line hero-mockup__line--short" />
          <div className="hero-mockup__line" />
          <div className="hero-mockup__line" />
          <div className="hero-mockup__line hero-mockup__line--medium" />
          <div className="hero-mockup__metrics">
            <div className="hero-mockup__metric">
              <span>PE</span>
              <strong>28.4</strong>
            </div>
            <div className="hero-mockup__metric">
              <span>ROE</span>
              <strong>32.1%</strong>
            </div>
            <div className="hero-mockup__metric hero-mockup__metric--up">
              <span>涨跌</span>
              <strong>+1.2%</strong>
            </div>
          </div>
        </div>
        <div className="hero-mockup__badge">质检 PASS</div>
      </div>
    </div>
  );
}
