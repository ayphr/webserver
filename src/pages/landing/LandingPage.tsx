import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  IconActivity,
  IconArrowRight,
  IconChartLine,
  IconCheck,
  IconCloud,
  IconCpu,
  IconDevices,
  IconMenu2,
  IconMinus,
  IconPlus,
  IconShieldCheck,
  IconX,
} from '@tabler/icons-react';
import { Button } from '../../components/common';
import { EXTERNAL_URLS } from '../../lib/externalUrls';
import logoSvg from '../../assets/logo.svg';
import heroSceneSvg from '../../assets/hero-sensor-scene.svg';
import { GlyphScene } from './GlyphScene';
import './LandingPage.css';

const ICON = { size: 18, stroke: 1.5 } as const;

const SectionHead = ({
  id,
  eyebrow,
  title,
  desc,
  note,
}: {
  id: string;
  eyebrow: string;
  title: string;
  desc?: string;
  note?: string;
}) => (
  <div className="landing-section__head">
    <span className="landing-eyebrow">{eyebrow}</span>
    <h2 id={id} className="landing-section__title">
      {title}
    </h2>
    {desc && <p className="landing-section__desc">{desc}</p>}
    {note && <p className="landing-section__note">{note}</p>}
  </div>
);

const LiveDot = ({ online = true, stale = false }: { online?: boolean; stale?: boolean }) => (
  <span
    className={`live-dot ${online ? (stale ? 'live-dot--stale' : '') : 'live-dot--off'}`}
    aria-hidden="true"
  />
);

const useReveal = () => {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!targets.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) markVisible(entry.target);
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -6% 0px' },
    );
    const markVisible = (target: Element) => {
      target.classList.add('is-visible');
      observer.unobserve(target);
    };
    const onScroll = () => {
      targets.forEach((target) => {
        if (target.classList.contains('is-visible')) return;
        if (target.getBoundingClientRect().top < window.innerHeight) markVisible(target);
      });
    };
    targets.forEach((target) => observer.observe(target));
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
};

const TRACE_VALUES = [22.1, 22.3, 22.2, 22.5, 22.4, 22.6, 22.4, 22.7, 22.5, 22.8, 22.6, 22.4];
const TRACE_POINTS = TRACE_VALUES.map((value, index) => {
  const x = (index / (TRACE_VALUES.length - 1)) * 320;
  const y = 48 - ((value - 21.8) / 1) * 36;
  return `${x.toFixed(1)},${y.toFixed(1)}`;
});
const TRACE_LINE = `M ${TRACE_POINTS.join(' L ')}`;
const TRACE_AREA = `${TRACE_LINE} L 320,64 L 0,64 Z`;
const PREVIOUS_VALUES = [21.9, 22, 21.8, 22.1, 22, 22.2, 22.1, 22.3, 22.2, 22.4, 22.3, 22.1];
const PREVIOUS_POINTS = PREVIOUS_VALUES.map((value, index) => {
  const x = (index / (PREVIOUS_VALUES.length - 1)) * 320;
  const y = 48 - ((value - 21.8) / 1) * 36;
  return `${x.toFixed(1)},${y.toFixed(1)}`;
});
const PREVIOUS_LINE = `M ${PREVIOUS_POINTS.join(' L ')}`;

const TraceChart = () => (
  <div className="landing-device-panel__chart">
    <div className="landing-device-panel__chart-head">
      <span>Node-A1 · temperature</span>
      <span className="landing-device-panel__legend">
        <span className="landing-device-panel__legend-item landing-device-panel__legend-item--now">
          now
        </span>
        <span className="landing-device-panel__legend-item">previous</span>
      </span>
    </div>
    <svg viewBox="0 0 320 64" preserveAspectRatio="none" aria-hidden="true">
      <g className="landing-device-panel__grid">
        <line x1="0" y1="12" x2="320" y2="12" />
        <line x1="0" y1="32" x2="320" y2="32" />
        <line x1="0" y1="52" x2="320" y2="52" />
      </g>
      <path className="landing-device-panel__area" d={TRACE_AREA} />
      <path className="landing-device-panel__trace landing-device-panel__trace--previous" d={PREVIOUS_LINE} />
      <path className="landing-device-panel__trace" d={TRACE_LINE} />
    </svg>
    <div className="landing-device-panel__axis">
      <span>09:00</span>
      <span>12:00</span>
      <span>now</span>
    </div>
  </div>
);

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
    title: 'Ingestion and storage',
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

const INTEGRATIONS = ['MQTT', 'REST API', 'Webhooks', 'Grafana', 'Slack', 'Discord'];

const LOGOS = [
  'MQTT',
  'REST API',
  'Webhooks',
  'CSV export',
  'JSON export',
  'Device tokens',
];

const SHOWCASE_DEVICES = [
  { name: 'Node-A1', value: '22.4°C', sync: 'last sync 2s ago', online: true, stale: false },
  { name: 'Node-B3', value: '48.2%', sync: 'last sync 6s ago', online: true, stale: false },
  { name: 'Node-C7', value: '1013 hPa', sync: 'last sync 4m ago', online: false, stale: true },
  { name: 'Node-D2', value: '20.1°C', sync: 'last sync 9s ago', online: true, stale: false },
];

const DeviceRows = ({ devices }: { devices: typeof SHOWCASE_DEVICES }) => (
  <div className="landing-device-list">
    {devices.map((device) => (
      <div className="landing-device-row" key={device.name}>
        <LiveDot online={device.online} stale={device.stale} />
        <span className="landing-device-row__name">{device.name}</span>
        <span className="landing-device-row__value">{device.value}</span>
        <span className="landing-device-row__sync">{device.sync}</span>
      </div>
    ))}
  </div>
);

export const LandingPage = () => {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useReveal();

  useEffect(() => {
    const previousOverflow = document.body.style.overflowY;
    document.body.style.overflowY = 'auto';
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.body.style.overflowY = previousOverflow;
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="landing-page">
      <header className={`landing-nav ${scrolled ? 'landing-nav--scrolled' : ''}`}>
        <span
          className="landing-nav__progress"
          style={{ transform: `scaleX(${progress})` }}
          aria-hidden="true"
        />
        <div className="landing-nav__inner">
          <Link to="/" className="landing-brand">
            <img src={logoSvg} alt="" className="landing-brand__logo" />
            <span>Ayphr</span>
          </Link>

          <nav className="landing-nav__links" aria-label="Main navigation">
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
              href={EXTERNAL_URLS.store}
              target="_blank"
              rel="noopener noreferrer"
              className="landing-nav__link"
            >
              Shop
            </a>
          </nav>

          <div className="landing-nav__actions">
            <Link to="/auth/login" className="landing-nav__link landing-nav__signin">
              Sign in
            </Link>
            <Button to="/auth/register" variant="primary" className="landing-nav__cta">
              Create free account
            </Button>
          </div>

          <div className="landing-nav__mobile-actions">
            <Link to="/auth/login" className="landing-nav__link landing-nav__signin">
              Sign in
            </Link>
            <Button to="/auth/register" variant="primary" className="landing-nav__cta">
              Create free account
            </Button>
            <button
              className="landing-nav__menu"
              type="button"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="landing-mobile-nav"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <IconX {...ICON} /> : <IconMenu2 {...ICON} />}
            </button>
          </div>
        </div>
        <nav
          id="landing-mobile-nav"
          className="landing-nav__mobile"
          aria-label="Mobile navigation"
          hidden={!menuOpen}
        >
          <a href="#features" onClick={closeMenu}>
            Features
          </a>
          <a href="#pricing" onClick={closeMenu}>
            Pricing
          </a>
          <a href="#faq" onClick={closeMenu}>
            FAQ
          </a>
          <a
            href={EXTERNAL_URLS.store}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
          >
            Shop
          </a>
        </nav>
      </header>

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="landing-hero__scene">
            <img
              src={heroSceneSvg}
              alt="A matte graphite sensor node on a dark workbench"
              className="landing-hero__scene-image"
            />
            <GlyphScene src={heroSceneSvg} cell={10} />
          </div>

          <div className="landing-hero__copy">
            <p className="landing-hero__note">First generation Geo pre-orders start 2027</p>
            <h1 id="hero-title" className="landing-hero__title">
              Sensor data, without the plumbing
            </h1>
            <p className="landing-hero__subtitle">
              Ayphr collects readings from your sensors and puts them in one dashboard. We make the
              hardware too.
            </p>
            <div className="landing-hero__actions">
              <Button to="/auth/register" variant="primary">
                <span>Get started</span>
                <IconArrowRight {...ICON} aria-hidden="true" />
              </Button>
              <Button
                href={EXTERNAL_URLS.store}
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
              >
                Shop hardware
              </Button>
            </div>
          </div>

        </section>

        <section className="landing-logos" aria-label="Platform capabilities" data-reveal>
          <p className="landing-logos__label">Works with</p>
          <div className="landing-logos__items">
            {LOGOS.map((name) => (
              <span key={name} className="landing-logos__item">
                {name}
              </span>
            ))}
          </div>
        </section>

        <section id="features" className="landing-features" aria-labelledby="features-title">
          <div className="landing-split">
            <div className="landing-split__head" data-reveal>
              <SectionHead
                id="features-title"
                eyebrow="01 / Features"
                title="From sensor to screen"
                desc="A small set of tools for getting sensor readings from the field to a screen."
                note="We make the hardware too: first-party Ayphr sensors work out of the box, with third-party and custom devices supported as a close second."
              />
            </div>
            <div className="landing-features__grid">
              {FEATURES.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <article
                    className="landing-feature"
                    key={feature.title}
                    data-reveal
                    style={{ '--reveal-delay': `${(index % 2) * 80}ms` } as CSSProperties}
                  >
                    <span className="landing-feature__icon">
                      <Icon {...ICON} aria-hidden="true" />
                    </span>
                    <div className="landing-feature__body">
                      <h3 className="landing-feature__title">{feature.title}</h3>
                      <p className="landing-feature__desc">{feature.desc}</p>
                    </div>
                    <span className="landing-feature__index" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-how" aria-labelledby="how-title">
          <div className="landing-split">
            <div className="landing-split__head" data-reveal>
              <SectionHead
                id="how-title"
                eyebrow="02 / How it works"
                title="Three steps to your first reading"
              />
            </div>
            <div className="landing-steps">
              {STEPS.map((step, index) => (
                <div
                  className="landing-step"
                  key={step.n}
                  data-reveal
                  style={{ '--reveal-delay': `${index * 80}ms` } as CSSProperties}
                >
                  <span className="landing-step__n">{step.n}</span>
                  <h3 className="landing-step__title">{step.title}</h3>
                  <p className="landing-step__desc">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-showcase" aria-labelledby="showcase-title">
          <div className="landing-showcase__copy" data-reveal>
            <SectionHead
              id="showcase-title"
              eyebrow="03 / Platform"
              title="Readings, status and history together"
              desc="Readings, device status, and history in one screen. Set alerts, export data, share with a teammate."
            />
            <ul className="landing-checks">
              <li>
                <IconCheck {...ICON} aria-hidden="true" /> Live charts
              </li>
              <li>
                <IconCheck {...ICON} aria-hidden="true" /> Per-device status
              </li>
              <li>
                <IconCheck {...ICON} aria-hidden="true" /> Alerts
              </li>
              <li>
                <IconCheck {...ICON} aria-hidden="true" /> CSV / JSON export
              </li>
            </ul>
            <Button to="/auth/register" variant="primary">
              <span>Get started</span>
              <IconArrowRight {...ICON} aria-hidden="true" />
            </Button>
          </div>

          <div className="landing-device-panel" data-reveal aria-hidden="true">
            <div className="landing-device-panel__head">
              <span>Devices</span>
              <span className="landing-device-panel__count">
                <LiveDot />
                12 online
              </span>
            </div>
            <TraceChart />
            <DeviceRows devices={SHOWCASE_DEVICES} />
          </div>
        </section>

        <section id="pricing" className="landing-pricing" aria-labelledby="pricing-title">
          <div data-reveal>
            <SectionHead
              id="pricing-title"
              eyebrow="04 / Plans"
              title="Pricing"
              desc="Pick a plan. Cancel anytime."
              note="Individual plans. A free plan with limited features is also available to get started."
            />
          </div>
          <div className="landing-pricing__grid">
            {PRICING.map((plan, index) => (
              <article
                className={`landing-price-card ${plan.highlight ? 'landing-price-card--highlight' : ''}`}
                key={plan.name}
                data-reveal
                style={{ '--reveal-delay': `${index * 80}ms` } as CSSProperties}
              >
                {plan.highlight && <span className="landing-price-card__badge">Most popular</span>}
                <h3 className="landing-price-card__name">{plan.name}</h3>
                <div className="landing-price-card__price">
                  <span className="landing-price-card__amount">{plan.price}</span>
                  <span className="landing-price-card__currency">{plan.currency}</span>
                  <span className="landing-price-card__period">{plan.period}</span>
                </div>
                <p className="landing-price-card__desc">{plan.desc}</p>
                <ul className="landing-price-card__features">
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <IconCheck {...ICON} aria-hidden="true" /> {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  to="/auth/register"
                  variant={plan.highlight ? 'primary' : 'secondary'}
                  fullWidth
                >
                  <span>Get started</span>
                  <IconArrowRight {...ICON} aria-hidden="true" />
                </Button>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-integrations" aria-labelledby="integrations-title">
          <div data-reveal>
            <SectionHead
              id="integrations-title"
              eyebrow="05 / Connect"
              title="Integrations"
              desc="Send data where you need it."
            />
          </div>
          <div className="landing-integration-grid" data-reveal>
            <div className="landing-integration-source">
              <span>Ayphr</span>
              <span className="landing-integration-source__meta">readings out</span>
            </div>
            <div className="landing-integration-targets">
              {INTEGRATIONS.map((name, index) => (
                <span key={name} className="landing-integration">
                  <span className="landing-integration__index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="landing-faq" aria-labelledby="faq-title">
          <div className="landing-split">
            <div className="landing-split__head" data-reveal>
              <SectionHead id="faq-title" eyebrow="06 / Questions" title="FAQ" />
            </div>
            <div className="landing-faq__list" data-reveal>
              {FAQS.map((faq, index) => {
                const open = openFaq === index;
                return (
                  <div className={`landing-faq__item ${open ? 'is-open' : ''}`} key={faq.q}>
                    <h3>
                      <button
                        className="landing-faq__question"
                        type="button"
                        onClick={() => setOpenFaq(open ? null : index)}
                        aria-expanded={open}
                        aria-controls={`faq-answer-${index}`}
                        id={`faq-question-${index}`}
                      >
                        <span className="landing-faq__index">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span>{faq.q}</span>
                        {open ? (
                          <IconMinus {...ICON} aria-hidden="true" />
                        ) : (
                          <IconPlus {...ICON} aria-hidden="true" />
                        )}
                      </button>
                    </h3>
                    <div
                      className="landing-faq__answer"
                      id={`faq-answer-${index}`}
                      role="region"
                      aria-labelledby={`faq-question-${index}`}
                      hidden={!open}
                    >
                      {faq.a}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-final-cta" aria-labelledby="final-cta-title">
          <div className="landing-final-cta__panel" data-reveal>
            <div>
              <h2 id="final-cta-title">Ready to send readings?</h2>
              <p>Create an account and start sending readings.</p>
            </div>
            <div className="landing-final-cta__actions">
              <Button to="/auth/register" variant="primary">
                <span>Get started</span>
                <IconArrowRight {...ICON} aria-hidden="true" />
              </Button>
              <Button to="/auth/login" variant="secondary">
                <span>Sign in</span>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer__inner">
          <div className="landing-footer__top">
            <div className="landing-footer__brand-info">
              <img src={logoSvg} alt="" className="landing-footer__logo" />
              <span className="landing-footer__name">Ayphr</span>
            </div>

            <nav className="landing-footer__links" aria-label="Footer links">
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
                href={EXTERNAL_URLS.store}
                target="_blank"
                rel="noopener noreferrer"
                className="landing-footer__link"
              >
                Shop
              </a>
            </nav>

            <nav className="landing-footer__links" aria-label="Legal links">
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
            <span>&copy; {new Date().getFullYear()} Ayphr · All rights reserved</span>
            <span>Made in Australia</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
