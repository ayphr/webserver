import { useEffect, useState } from 'react';
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

const sparklinePath = (values: number[], width: number, height: number) => {
  const min = Math.min(...values);
  const span = Math.max(0.0001, Math.max(...values) - min);
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - 2 - ((value - min) / span) * (height - 4);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
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
    desc: 'Paste it into your firmware.',
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

const PLATFORM_ITEMS = [
  'Device tokens',
  'Live charts',
  'History',
  'Queries',
  'Assistant',
  'Locations',
  'Team management',
  'Integrations',
  'Alerts',
  'Webhooks',
  'Permissions',
  'Sharing',
  'CSV export',
  'JSON export',
  'REST API',
  'MQTT',
  'Grafana',
  'Slack',
  'Discord',
  'Notifications',
];

const IncludedGroup = ({ duplicate = false }: { duplicate?: boolean }) => (
  <div className="landing-logos__group" aria-hidden={duplicate || undefined}>
    {PLATFORM_ITEMS.map((name) => (
      <span key={name} className="landing-logos__item">
        {name}
      </span>
    ))}
  </div>
);

const SHOWCASE_DEVICES = [
  {
    name: 'Node-A1',
    value: '22.4°C',
    sync: '2s ago',
    online: true,
    stale: false,
    series: [22.1, 22.3, 22.2, 22.5, 22.4, 22.6, 22.4, 22.7, 22.5, 22.8, 22.6, 22.4],
  },
  {
    name: 'Node-B3',
    value: '48.2%',
    sync: '6s ago',
    online: true,
    stale: false,
    series: [47.9, 48.1, 48, 48.4, 48.2, 48.3, 48.1, 48.5, 48.2, 48.4, 48.1, 48.2],
  },
  {
    name: 'Node-C7',
    value: '1013 hPa',
    sync: '4m ago',
    online: false,
    stale: true,
    series: [1012.8, 1013.1, 1012.9, 1013.4, 1013, 1012.7, 1013.2, 1013.5, 1013.1, 1012.9, 1013.3, 1013],
  },
  {
    name: 'Node-D2',
    value: '20.1°C',
    sync: '9s ago',
    online: true,
    stale: false,
    series: [19.9, 20, 19.8, 20.2, 20.1, 20.3, 20, 20.2, 19.9, 20.1, 20, 20.1],
  },
];

const DETAIL_WIDTH = 600;
const DETAIL_HEIGHT = 60;
const DETAIL_LINE = sparklinePath(SHOWCASE_DEVICES[0].series, DETAIL_WIDTH, DETAIL_HEIGHT);
const DETAIL_AREA = `${DETAIL_LINE} L ${DETAIL_WIDTH},${DETAIL_HEIGHT} L 0,${DETAIL_HEIGHT} Z`;

const NodeRack = () => (
  <div className="landing-device-panel landing-node-rack" aria-hidden="true">
    <div className="landing-device-panel__head">
      <span>Fleet · workshop</span>
      <span className="landing-device-panel__count">
        <LiveDot />4 nodes
      </span>
    </div>
    <div className="landing-node-rack__grid">
      {SHOWCASE_DEVICES.map((device, index) => (
        <div
          className={`landing-node ${index === 0 ? 'landing-node--active' : ''}`}
          key={device.name}
        >
          <div className="landing-node__top">
            <span>{device.name}</span>
            <LiveDot online={device.online} stale={device.stale} />
          </div>
          <div className="landing-node__value">{device.value}</div>
          <svg
            className="landing-node__spark"
            viewBox="0 0 100 24"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d={sparklinePath(device.series, 100, 24)} />
          </svg>
          <span className="landing-node__age">last sync {device.sync}</span>
        </div>
      ))}
    </div>
    <div className="landing-node-rack__detail">
      <div className="landing-node-rack__detail-head">
        <span>Node-A1 · temperature</span>
        <span>last 6 hours</span>
      </div>
      <svg viewBox={`0 0 ${DETAIL_WIDTH} ${DETAIL_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="landing-node-rack__detail-area" d={DETAIL_AREA} />
        <path className="landing-node-rack__detail-line" d={DETAIL_LINE} />
      </svg>
    </div>
  </div>
);

export const LandingPage = () => {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

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
            <p className="landing-hero__note">First-gen Geo sensors · pre-orders open 2027</p>
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

        <section className="landing-logos" aria-label="Included platform features">
          <p className="landing-logos__label">Included</p>
          <div className="landing-logos__viewport">
            <div className="landing-logos__track">
              <IncludedGroup />
              <IncludedGroup duplicate />
            </div>
          </div>
        </section>

        <section id="features" className="landing-features" aria-labelledby="features-title">
          <div className="landing-split">
            <div className="landing-split__head">
              <SectionHead
                id="features-title"
                eyebrow="01 / Features"
                title="From sensor to screen"
                desc="A small set of tools for getting sensor readings from the field to a screen."
                note="First-party sensors work out of the box. Third-party devices are welcome too, as long as they can POST JSON."
              />
            </div>
            <div className="landing-features__grid">
              {FEATURES.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <article
                    className="landing-feature"
                    key={feature.title}
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
            <div className="landing-split__head">
              <SectionHead
                id="how-title"
                eyebrow="02 / How it works"
                title="Three steps to your first reading"
              />
            </div>
            <div className="landing-steps">
              {STEPS.map((step) => (
                <div
                  className="landing-step"
                  key={step.n}
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
          <div className="landing-showcase__copy">
            <SectionHead
              id="showcase-title"
              eyebrow="03 / Platform"
              title="Readings, status and history together"
              desc="Spot a problem, compare a trend, or export a range without switching tools."
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

          <NodeRack />
        </section>

        <section id="pricing" className="landing-pricing" aria-labelledby="pricing-title">
          <div>
            <SectionHead
              id="pricing-title"
              eyebrow="04 / Plans"
              title="Pricing"
              desc="Pick a plan. Cancel anytime."
              note="Billed monthly in AUD. A limited free plan is available to try."
            />
          </div>
          <div className="landing-pricing__grid">
            {PRICING.map((plan) => (
              <article
                className={`landing-price-card ${plan.highlight ? 'landing-price-card--highlight' : ''}`}
                key={plan.name}
              >
                {plan.highlight && <span className="landing-price-card__badge">Most popular</span>}
                <h3 className="landing-price-card__name">{plan.name}</h3>
                <div className="landing-price-card__price">
                  <span className="landing-price-card__currency">{plan.currency}</span>
                  <span className="landing-price-card__amount">{plan.price}</span>
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
          <div>
            <SectionHead
              id="integrations-title"
              eyebrow="05 / Connect"
              title="Integrations"
              desc="Push readings into the tools you already use."
            />
          </div>
          <div className="landing-integration-grid">
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
            <div className="landing-split__head">
              <SectionHead id="faq-title" eyebrow="06 / Questions" title="FAQ" />
            </div>
            <div className="landing-faq__list">
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
          <div className="landing-final-cta__panel">
            <div>
              <h2 id="final-cta-title">Start with one sensor.</h2>
              <p>Create an account, generate a token, and watch the first reading land.</p>
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
