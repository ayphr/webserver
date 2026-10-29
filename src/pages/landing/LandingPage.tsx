import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconActivity,
  IconArrowRight,
  IconChartLine,
  IconCheck,
  IconCloud,
  IconCpu,
  IconDevices,
  IconGlobe,
  IconMinus,
  IconPlus,
  IconQuote,
  IconRocket,
  IconShieldCheck,
  IconStar,
} from '@tabler/icons-react';
import { Button, Card } from '../../components/common';
import logoSvg from '../../assets/logo.svg';
import './LandingPage.css';

const Reveal = ({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'reveal--visible' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

const Counter = ({ to, suffix = '' }: { to: number; suffix?: string }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (reduce) {
            setValue(to);
            obs.disconnect();
            return;
          }
          const duration = 1600;
          const start = performance.now();
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setValue(Math.round(to * eased));
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          obs.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [to]);

  return (
    <span ref={ref}>
      {value.toLocaleString()}
      {suffix}
    </span>
  );
};

const FEATURES = [
  {
    icon: IconActivity,
    title: 'Live readings',
    desc: 'Temperature, humidity, pressure, updating as devices report.',
  },
  {
    icon: IconCpu,
    title: 'Easy device setup',
    desc: 'Generate a token, paste it into firmware, done.',
  },
  {
    icon: IconShieldCheck,
    title: 'Access control',
    desc: 'Invite teammates, set permissions, revoke tokens.',
  },
  {
    icon: IconChartLine,
    title: 'History and trends',
    desc: 'Look back at readings, export when you need to.',
  },
  {
    icon: IconDevices,
    title: 'Fleet view',
    desc: 'See which devices are online and when they last checked in.',
  },
  {
    icon: IconCloud,
    title: 'Handles the boring parts',
    desc: 'Ingestion, storage, and backpressure handled for you.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Make a token',
    desc: 'Create one in the dashboard.',
  },
  {
    n: '02',
    title: 'Put it in your device',
    desc: 'Add the token to your firmware.',
  },
  {
    n: '03',
    title: 'See readings arrive',
    desc: 'Charts and history show up immediately.',
  },
];

const STATS = [
  { to: 99.9, suffix: '%', label: 'Uptime SLA' },
  { to: 50, suffix: 'ms', label: 'Median ingest latency' },
  { to: 10, suffix: 'M+', label: 'Data points / day' },
  { to: 24, suffix: '/7', label: 'Monitoring' },
];

const PRICING = [
  {
    name: 'Lite',
    price: '$9.99',
    currency: 'AUD',
    period: '/mo',
    desc: 'For small projects.',
    features: ['500 credits / month', '10M data points', '30-day retention', '10 devices'],
    highlight: false,
  },
  {
    name: 'Plus',
    price: '$14.99',
    currency: 'AUD',
    period: '/mo',
    desc: 'For growing projects.',
    features: [
      '750 credits / month',
      '20M data points',
      '2-month retention',
      '25 devices',
      'Alerts & webhooks',
      'Priority support',
      'Data access for 1 other user',
    ],
    highlight: true,
  },
  {
    name: 'Ultra',
    price: '$22.99',
    currency: 'AUD',
    period: '/mo',
    desc: 'For large fleets.',
    features: [
      '5,000 credits / month',
      '150M data points',
      '1-year retention',
      '50 devices',
      'Alerts & webhooks',
      'Priority support',
      'Data access for 5 other users',
    ],
    highlight: false,
  },
];

const TESTIMONIALS = [
  {
    quote: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    name: 'Lorem Ipsum',
    role: 'Lorem Ipsum',
  },
  {
    quote: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    name: 'Lorem Ipsum',
    role: 'Lorem Ipsum',
  },
  {
    quote: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    name: 'Lorem Ipsum',
    role: 'Lorem Ipsum',
  },
];

const FAQS = [
  {
    q: 'Is there a free plan?',
    a: 'Yes. A free plan with limited features is available so you can create an account, explore the dashboard, and try ingestion before committing to a paid plan.',
  },
  {
    q: 'What are credits?',
    a: 'Credits power AI features and large-scale data querying. Each paid plan includes a monthly credit allowance that resets every billing cycle, so you can analyze and ask questions of your telemetry without surprise costs.',
  },
  {
    q: 'How do the plans differ?',
    a: 'Plans differ by monthly credits, data point volume, retention period, device limits, and collaboration features. Lite suits small labs, Plus adds alerts and sharing for one other user, and Ultra scales to larger fleets with sharing for up to five users.',
  },
  {
    q: 'Can I share data with other users?',
    a: 'Yes. Plus includes data access for one other user and Ultra for up to five. Sharing is read access to your device data and dashboards.',
  },
  {
    q: 'Do you make hardware?',
    a: 'Yes. We build first-party Ayphr sensors that work out of the box. Third-party and custom devices are supported as well, as a close second priority.',
  },
  {
    q: 'What sensors are supported?',
    a: 'Anything that can POST JSON. Temperature, humidity, and barometric pressure are first-class fields, but metadata is flexible for custom sensors.',
  },
  {
    q: 'Can I export my data?',
    a: 'Yes. CSV and JSON exports are available on every plan, with scheduled exports on Plus and above.',
  },
  {
    q: 'How do devices authenticate?',
    a: 'Each device uses a cryptographic token generated from your dashboard. Tokens are validated on every upload and can be revoked instantly.',
  },
  {
    q: 'How is my data secured?',
    a: 'All traffic is TLS-encrypted, tokens are hashed at rest, and access is governed by granular permissions and plan-level sharing controls.',
  },
];

const INTEGRATIONS = [
  'MQTT',
  'REST API',
  'Webhooks',
  'Grafana',
  'Slack',
  'Discord'
];

const LOGOS = ['Placeholder', 'Placeholder', 'Placeholder', 'Placeholder', 'Placeholder', 'Placeholder'];

const FeatureVisual = ({ index }: { index: number }) => {
  if (index === 0) {
    return (
      <div className="feature-visual feature-visual--wave">
        <svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
          <path
            d="M0 30 Q 25 5, 50 30 T 100 30 T 150 30 T 200 30"
            fill="none"
            stroke="#7ef09a"
            strokeWidth="2"
            opacity="0.9"
          />
          <path
            d="M0 30 Q 25 55, 50 30 T 100 30 T 150 30 T 200 30"
            fill="none"
            stroke="rgba(126,240,154,0.35)"
            strokeWidth="1.5"
            opacity="0.7"
          />
        </svg>
        <div className="feature-visual__metrics">
          <span>22.4°</span>
          <span>48%</span>
          <span>1013</span>
        </div>
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="feature-visual feature-visual--code">
        <div className="feature-visual__code-line">
          <span className="feature-visual__code-key">token</span> = "ayphr_7f3a…"
        </div>
        <div className="feature-visual__code-line feature-visual__code-line--muted">
          // paste into firmware
        </div>
        <div className="feature-visual__code-line">
          <span className="feature-visual__code-key">upload</span>(reading)
        </div>
        <div className="feature-visual__code-line feature-visual__code-line--ok">
          ok 200
        </div>
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className="feature-visual feature-visual--users">
        {['Mara', 'Daniel', 'Priya'].map((name, i) => (
          <div key={name} className="feature-visual__user">
            <span className="feature-visual__avatar">{name[0]}</span>
            <span className="feature-visual__username">{name}</span>
            <span className="feature-visual__role">
              {i === 0 ? 'owner' : 'viewer'}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (index === 3) {
    return (
      <div className="feature-visual feature-visual--line">
        <svg viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true">
          <polyline
            points="0,60 20,55 40,40 60,45 80,25 100,30 120,15 140,20 160,10 180,18 200,8"
            fill="none"
            stroke="#7ef09a"
            strokeWidth="2"
          />
          <polyline
            points="0,70 20,68 40,60 60,62 80,50 100,52 120,44 140,46 160,38 180,40 200,32"
            fill="none"
            stroke="rgba(90,180,255,0.7)"
            strokeWidth="1.5"
          />
        </svg>
      </div>
    );
  }
  if (index === 4) {
    return (
      <div className="feature-visual feature-visual--fleet">
        {['Node-A1', 'Node-B3', 'Node-C7', 'Node-D2'].map((name, i) => (
          <div key={name} className="feature-visual__device">
            <span
              className={`feature-visual__dot ${i === 2 ? 'feature-visual__dot--off' : ''}`}
            />
            <span className="feature-visual__device-name">{name}</span>
            <span className="feature-visual__device-meta">
              {i === 2 ? 'offline' : 'online'}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="feature-visual feature-visual--pipeline">
      {['ingest', 'store', 'query', 'alert'].map((step, i) => (
        <div key={step} className="feature-visual__pipeline-step">
          <span>{step}</span>
          {i < 3 && <span className="feature-visual__arrow">→</span>}
        </div>
      ))}
    </div>
  );
};

export const LandingPage = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [marqueeReady, setMarqueeReady] = useState(false);

  useEffect(() => {
    const ready = () => setMarqueeReady(true);
    if (document.fonts?.ready) {
      document.fonts.ready.then(ready).catch(ready);
    } else {
      ready();
    }
    const fallback = window.setTimeout(ready, 800);
    return () => window.clearTimeout(fallback);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onScroll = () => {
      setScrolled(el.scrollTop > 24);
      el.style.setProperty('--scroll', String(el.scrollTop));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="landing-page" ref={rootRef}>
      {/* Nav */}
      <header className={`landing-nav ${scrolled ? 'landing-nav--scrolled' : ''}`}>
        <div className="landing-nav__inner">
          <Link to="/" className="landing-brand">
            <img src={logoSvg} alt="Ayphr Logo" className="landing-brand__logo" />
            <span>Ayphr</span>
          </Link>

          <nav className="landing-nav__links" aria-label="Main Navigation">
            <a href="#features" className="landing-nav__link">
              Features
            </a>
            <a href="#pricing" className="landing-nav__link">
              Pricing
            </a>
            <a href="#faq" className="landing-nav__link">
              FAQ
            </a>
            <a
              href="https://store.ayphr.com"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-nav__link"
            >
              Shop
            </a>
            <Button to="/auth/login" variant="primary">
              <span>Sign In</span>
              <IconArrowRight size={16} aria-hidden="true" />
            </Button>
          </nav>
        </div>
      </header>

      <main className="landing-main">
        {/* Hero */}
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="landing-hero__bg" aria-hidden="true">
            <div className="landing-hero__grid" />
            <div className="landing-hero__orb landing-hero__orb--1" />
            <div className="landing-hero__orb landing-hero__orb--2" />
            <div className="landing-hero__orb landing-hero__orb--3" />
          </div>

          <Reveal>
            <span className="landing-hero__eyebrow">
              First generation Geo pre-orders start 2027
            </span>
          </Reveal>

          <Reveal delay={80}>
            <h1 id="hero-title" className="landing-hero__title">
              Sensor data,{' '}
              <span className="landing-hero__gradient-text">without the plumbing</span>
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="landing-hero__subtitle">
              Ayphr collects readings from your sensors and puts them in one dashboard. We make the hardware too.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="landing-hero__actions">
              <Button to="/auth/register" variant="primary">
                <span>Get started</span>
                <IconArrowRight size={18} aria-hidden="true" />
              </Button>
              <Button
                href="https://store.ayphr.com"
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
              >
                Shop Hardware
              </Button>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <div className="landing-hero__mockup" aria-hidden="true">
              <div className="landing-mockup__bar">
                <span className="landing-mockup__dot" />
                <span className="landing-mockup__dot" />
                <span className="landing-mockup__dot" />
                <span className="landing-mockup__title">ayphr / live telemetry</span>
              </div>
              <div className="landing-mockup__body">
                <div className="landing-mockup__row">
                  <div className="landing-mockup__metric">
                    <span className="landing-mockup__label">Temperature</span>
                    <span className="landing-mockup__value">22.4°C</span>
                    <span className="landing-mockup__trend landing-mockup__trend--up">+0.3</span>
                  </div>
                  <div className="landing-mockup__metric">
                    <span className="landing-mockup__label">Humidity</span>
                    <span className="landing-mockup__value">48.2%</span>
                    <span className="landing-mockup__trend">stable</span>
                  </div>
                  <div className="landing-mockup__metric">
                    <span className="landing-mockup__label">Pressure</span>
                    <span className="landing-mockup__value">1013 hPa</span>
                    <span className="landing-mockup__trend landing-mockup__trend--down">-1.1</span>
                  </div>
                </div>
                <div className="landing-mockup__chart">
                  {Array.from({ length: 32 }).map((_, i) => (
                    <span
                      key={i}
                      className="landing-mockup__bar-col"
                      style={{ height: `${30 + Math.sin(i * 0.6) * 20 + (i % 5) * 4}%` }}
                    />
                  ))}
                </div>
                <div className="landing-mockup__footer">
                  <span className="landing-mockup__pulse" />
                  <span>3 devices online · last sync 2s ago</span>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* Logos */}
        <section className="landing-logos" aria-label="Trusted by">
          <Reveal>
            <p className="landing-logos__label">Used by</p>
          </Reveal>
          <div className="landing-logos__marquee">
            <div
              className={`landing-logos__track ${marqueeReady ? 'landing-logos__track--animate' : ''}`}
            >
              {[...LOGOS, ...LOGOS].map((name, i) => (
                <span key={i} className="landing-logos__item">
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="landing-features" aria-labelledby="features-title">
          <Reveal>
            <div className="landing-features__header">
              <span className="landing-section__eyebrow">Features</span>
              <h2 id="features-title" className="landing-features__heading">
                What it does
              </h2>
              <p className="landing-features__desc">
                A small set of tools for getting sensor readings from the field to a screen.
              </p>
              <p className="landing-features__note">
                We make the hardware too: first-party Ayphr sensors work out of the box, with third-party and custom devices supported as a close second.
              </p>
            </div>
          </Reveal>

          <div className="landing-features__list">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              const reverse = i % 2 === 1;
              return (
                <Reveal key={f.title} delay={i * 60}>
                  <article
                    className={`landing-feature-section ${
                      reverse ? 'landing-feature-section--reverse' : ''
                    }`}
                  >
                    <div className="landing-feature-section__text">
                      <div className="landing-feature-section__icon">
                        <Icon size={22} aria-hidden="true" />
                      </div>
                      <h3 className="landing-feature-section__title">{f.title}</h3>
                      <p className="landing-feature-section__desc">{f.desc}</p>
                    </div>
                    <div className="landing-feature-section__visual" aria-hidden="true">
                      <div className="landing-feature-section__bg">
                        <div className="landing-feature-section__grid" />
                        <div className="landing-feature-section__orb landing-feature-section__orb--1" />
                        <div className="landing-feature-section__orb landing-feature-section__orb--2" />
                      </div>
                      <div className="landing-feature-section__visual-inner">
                        <FeatureVisual index={i} />
                      </div>
                    </div>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </section>

        {/* How it works */}
        <section className="landing-how" aria-labelledby="how-title">
          <Reveal>
            <div className="landing-how__header">
              <span className="landing-section__eyebrow">How it works</span>
              <h2 id="how-title" className="landing-how__heading">
                Getting started
              </h2>
            </div>
          </Reveal>

          <div className="landing-how__steps">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 120}>
                <div className="landing-step">
                  <div className="landing-step__number">{s.n}</div>
                  <h3 className="landing-step__title">{s.title}</h3>
                  <p className="landing-step__desc">{s.desc}</p>
                  {i < STEPS.length - 1 && <div className="landing-step__connector" aria-hidden="true" />}
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Product showcase */}
        <section className="landing-showcase" aria-labelledby="showcase-title">
          <Reveal>
            <div className="landing-showcase__text">
              <span className="landing-section__eyebrow">Platform</span>
              <h2 id="showcase-title" className="landing-showcase__heading">
                Everything in one place
              </h2>
              <p className="landing-showcase__desc">
                Readings, device status, and history in one screen. Set alerts, export data, share with a teammate.
              </p>
              <ul className="landing-showcase__list">
                <li>
                  <IconCheck size={16} /> Live charts
                </li>
                <li>
                  <IconCheck size={16} /> Per-device status
                </li>
                <li>
                  <IconCheck size={16} /> Alerts
                </li>
                <li>
                  <IconCheck size={16} /> CSV / JSON export
                </li>
              </ul>
              <Button to="/auth/register" variant="primary">
                <span>Get started</span>
                <IconArrowRight size={18} aria-hidden="true" />
              </Button>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="landing-showcase__visual" aria-hidden="true">
              <div className="landing-showcase__card landing-showcase__card--back" />
              <div className="landing-showcase__card landing-showcase__card--front">
                <div className="landing-showcase__front-head">
                  <span>Devices</span>
                  <span className="landing-showcase__badge">12 online</span>
                </div>
                <div className="landing-showcase__rows">
                  {['Node-A1', 'Node-B3', 'Node-C7', 'Node-D2'].map((name, i) => (
                    <div key={name} className="landing-showcase__row">
                      <span className="landing-showcase__row-name">{name}</span>
                      <span className="landing-showcase__row-bar">
                        <span
                          className="landing-showcase__row-fill"
                          style={{ width: `${60 + i * 9}%` }}
                        />
                      </span>
                      <span className="landing-showcase__row-val">{(20 + i * 1.3).toFixed(1)}°C</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* Stats */}
        <section className="landing-stats" aria-labelledby="stats-title">
          <Reveal>
            <h2 id="stats-title" className="landing-stats__heading">
              By the numbers
            </h2>
          </Reveal>
          <div className="landing-stats__grid">
            {STATS.map((s, i) => (
              <Reveal key={s.label} delay={i * 100}>
                <div className="landing-stat">
                  <div className="landing-stat__value">
                    <Counter to={s.to} suffix={s.suffix} />
                  </div>
                  <div className="landing-stat__label">{s.label}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="landing-pricing" aria-labelledby="pricing-title">
          <Reveal>
            <div className="landing-pricing__header">
              <span className="landing-section__eyebrow">Pricing</span>
              <h2 id="pricing-title" className="landing-pricing__heading">
                Pricing
              </h2>
              <p className="landing-pricing__desc">Pick a plan. Cancel anytime.</p>
              <p className="landing-pricing__note">
                Individual plans. A free plan with limited features is also available to get started.
              </p>
            </div>
          </Reveal>

          <div className="landing-pricing__grid">
            {PRICING.map((p, i) => (
              <Reveal key={p.name} delay={i * 100}>
                <Card
                  className={`landing-price-card ${p.highlight ? 'landing-price-card--highlight' : ''}`}
                  elevated={p.highlight}
                >
                  {p.highlight && <span className="landing-price-card__badge">Most popular</span>}
                  <h3 className="landing-price-card__name">{p.name}</h3>
                  <div className="landing-price-card__price">
                    <span className="landing-price-card__amount">{p.price}</span>
                    <span className="landing-price-card__currency">{p.currency}</span>
                    <span className="landing-price-card__period">{p.period}</span>
                  </div>
                  <p className="landing-price-card__desc">{p.desc}</p>
                  <ul className="landing-price-card__features">
                    {p.features.map((f) => (
                      <li key={f}>
                        <IconCheck size={16} /> {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    to="/auth/register"
                    variant={p.highlight ? 'primary' : 'secondary'}
                    fullWidth
                  >
                    <span>Get started</span>
                    <IconArrowRight size={16} aria-hidden="true" />
                  </Button>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Testimonials */}
        <section className="landing-testimonials" aria-labelledby="testimonials-title">
          <Reveal>
            <div className="landing-testimonials__header">
              <span className="landing-section__eyebrow">Testimonials</span>
              <h2 id="testimonials-title" className="landing-testimonials__heading">
                What people say
              </h2>
            </div>
          </Reveal>

          <div className="landing-testimonials__grid">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 100}>
                <Card className="landing-testimonial-card">
                  <IconQuote size={28} className="landing-testimonial-card__quote" aria-hidden="true" />
                  <p className="landing-testimonial-card__text">{t.quote}</p>
                  <div className="landing-testimonial-card__author">
                    <div className="landing-testimonial-card__avatar">
                      {t.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')}
                    </div>
                    <div>
                      <div className="landing-testimonial-card__name">{t.name}</div>
                      <div className="landing-testimonial-card__role">{t.role}</div>
                    </div>
                  </div>
                  <div className="landing-testimonial-card__stars" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <IconStar key={j} size={14} />
                    ))}
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Integrations */}
        <section className="landing-integrations" aria-labelledby="integrations-title">
          <Reveal>
            <div className="landing-integrations__header">
              <span className="landing-section__eyebrow">Integrations</span>
              <h2 id="integrations-title" className="landing-integrations__heading">
                Integrations
              </h2>
              <p className="landing-integrations__desc">
                Send data where you need it.
              </p>
            </div>
          </Reveal>
          <div className="landing-integrations__chips">
            {INTEGRATIONS.map((name, i) => (
              <Reveal key={name} delay={i * 60}>
                <span className="landing-integration-chip">
                  <IconGlobe size={16} /> {name}
                </span>
              </Reveal>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="landing-faq" aria-labelledby="faq-title">
          <Reveal>
            <div className="landing-faq__header">
              <span className="landing-section__eyebrow">FAQ</span>
              <h2 id="faq-title" className="landing-faq__heading">
                FAQ
              </h2>
            </div>
          </Reveal>

          <div className="landing-faq__list">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <Reveal key={f.q} delay={i * 60}>
                  <div className={`landing-faq__item ${open ? 'landing-faq__item--open' : ''}`}>
                    <button
                      className="landing-faq__question"
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                    >
                      <span>{f.q}</span>
                      {open ? <IconMinus size={18} /> : <IconPlus size={18} />}
                    </button>
                    <div className={`landing-faq__answer ${open ? 'landing-faq__answer--open' : ''}`}>
                      <div className="landing-faq__answer-inner">
                        <p>{f.a}</p>
                      </div>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </section>

        {/* Final CTA */}
        <section className="landing-final-cta" aria-labelledby="final-cta-title">
          <Reveal>
            <Card elevated className="landing-final-cta__card">
              <div className="landing-final-cta__content">
                <h2 id="final-cta-title">Want to try it?</h2>
                <p>Create an account and start sending readings.</p>
              </div>
              <div className="landing-final-cta__actions">
                <Button to="/auth/register" variant="primary">
                  <span>Get Started</span>
                  <IconArrowRight size={18} aria-hidden="true" />
                </Button>
                <Button to="/auth/login" variant="secondary">
                  <span>Sign In</span>
                </Button>
              </div>
            </Card>
          </Reveal>
        </section>
      </main>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer__inner">
          <div className="landing-footer__top">
            <div className="landing-footer__brand-info">
              <img src={logoSvg} alt="Ayphr Logo" className="landing-footer__logo" />
              <span className="landing-footer__name">Ayphr</span>
            </div>

            <nav className="landing-footer__links" aria-label="Footer Links">
              <a href="#features" className="landing-footer__link">
                Features
              </a>
              <a href="#pricing" className="landing-footer__link">
                Pricing
              </a>
              <a href="#faq" className="landing-footer__link">
                FAQ
              </a>
              <a
                href="https://store.ayphr.com"
                target="_blank"
                rel="noopener noreferrer"
                className="landing-footer__link"
              >
                Shop
              </a>
            </nav>

            <nav className="landing-footer__links" aria-label="Legal Links">
              <Link to="/policies/terms" className="landing-footer__link">
                Terms
              </Link>
              <Link to="/policies/privacy" className="landing-footer__link">
                Privacy
              </Link>
              <Link to="/policies/refunds" className="landing-footer__link">
                Refunds
              </Link>
            </nav>
          </div>

          <div className="landing-footer__bottom">
            <span>&copy; {new Date().getFullYear()} Ayphr. All rights reserved.</span>
            <span className="landing-footer__social">
              <IconRocket size={14} /> Made in-house
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};
