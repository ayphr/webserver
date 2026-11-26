import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBellRinging,
  IconDeviceDesktopAnalytics,
  IconPlus,
  IconTerminal2,
} from '@tabler/icons-react';
import { Button } from '../../components/common';
import { LineGraph } from '../../components/graphs';
import type { LineGraphConfig, LineGraphData } from '../../components/graphs/types';
import { CHART_COLORS, createLineGraphConfig, resolveCssColor } from '../../lib/chartTheme';
import { EXTERNAL_URLS } from '../../lib/externalUrls';
import logoSvg from '../../assets/logo.svg';

const ICON = { size: 18, stroke: 1.5 } as const;
const SMALL_ICON = { size: 16, stroke: 1.5 } as const;

/* Reveal each block once as it enters the viewport. The class is added by an
   IntersectionObserver so sections never replay on scroll back up. */
const useReveal = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      node.classList.add('is-visible');
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        node.classList.add('is-visible');
        observer.disconnect();
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return ref;
};

const Reveal = ({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) => {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`landing-reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
};

const SectionHead = ({
  id,
  eyebrow,
  title,
  lede,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede?: string;
}) => (
  <header className="landing-section__head">
    <p className="landing-eyebrow">{eyebrow}</p>
    <h2 className="landing-heading" id={id}>
      {title}
    </h2>
    {lede ? <p className="landing-lede">{lede}</p> : null}
  </header>
);

const TAGLINE = ['Every reading in one place.', 'Every change worth knowing.'];

export const TaglineReveal = () => {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const words = Array.from(node.querySelectorAll<HTMLElement>('.landing-tagline__word'));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      words.forEach((word) => word.classList.add('is-active'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-active');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '-38% 0px -38% 0px', threshold: 0 },
    );
    words.forEach((word) => observer.observe(word));
    return () => observer.disconnect();
  }, []);

  return (
    <section className="landing-tagline" aria-label="Ayphr in one sentence">
      <p ref={ref} className="landing-tagline__text">
        {TAGLINE.map((line) => {
          const words = line.split(' ');
          return (
            <span key={line} className="landing-tagline__line">
              {words.map((word, index) => (
                <span key={`${word}-${index}`}>
                  <span className="landing-tagline__word">{word}</span>
                  {index < words.length - 1 ? ' ' : null}
                </span>
              ))}
            </span>
          );
        })}
      </p>
    </section>
  );
};

const BENEFITS = [
  {
    icon: IconDeviceDesktopAnalytics,
    title: 'One dashboard for every device',
    body: 'Live values, logs and history sit together. Filter by device or location and stop stitching exports together.',
  },
  {
    icon: IconTerminal2,
    title: 'Query in TQL, or ask Iris',
    body: 'Write TQL when you want precision. Describe the result when you do not, and Iris drafts the query for you.',
  },
  {
    icon: IconBellRinging,
    title: 'Alerts that reach people',
    body: 'Send device alerts to email, browser push, Discord, Slack or your own webhook, and mute the types you do not need.',
  },
];

export const Benefits = () => (
  <section className="landing-section" aria-labelledby="benefits-title">
    <Reveal>
      <SectionHead
        id="benefits-title"
        eyebrow="Why Ayphr"
        title="Less plumbing, more signal"
        lede="Ayphr handles collection, storage and delivery so your team can spend its time on the readings themselves."
      />
    </Reveal>
    <div className="landing-benefits">
      {BENEFITS.map((benefit, index) => {
        const Icon = benefit.icon;
        return (
          <Reveal key={benefit.title} className="landing-benefits__item" delay={index * 70}>
            <article className="landing-card">
              <span className="landing-card__icon">
                <Icon {...ICON} aria-hidden="true" />
              </span>
              <h3 className="landing-card__title">{benefit.title}</h3>
              <p className="landing-card__body">{benefit.body}</p>
            </article>
          </Reveal>
        );
      })}
    </div>
  </section>
);

const DEVICES = [
  { name: 'Geo 01', place: 'Cold room', reading: '21.4 °C' },
  { name: 'Geo 02', place: 'Greenhouse', reading: '24.8 °C' },
  { name: 'Geo 03', place: 'Workshop', reading: '18.2 °C' },
];

const CHART_START = new Date(2026, 10, 26, 9, 0).getTime();
const CHART_STEP_MS = 30 * 60 * 1000;
const RECORDED_VALUES = [20.8, 20.9, 21.1, 21.0, 21.3, 21.6, 21.4, 21.2, 21.5, 21.9, 21.7, 21.5, 21.4];
const FORECAST_VALUES = [21.4, 21.5, 21.7, 21.6, 21.9];

const chartPoint = (value: number, index: number) => ({
  x: CHART_START + index * CHART_STEP_MS,
  y: value,
});

const timeLabel = (value: number) =>
  new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export const PreviewSection = () => {
  const lineColor = resolveCssColor('var(--text-primary)');
  const dimColor = resolveCssColor('var(--text-dim)');
  const gridColor = resolveCssColor(CHART_COLORS.grid);

  const chartData: LineGraphData = {
    datasets: [
      {
        label: 'Recorded',
        data: RECORDED_VALUES.map(chartPoint),
        parsing: false,
        borderColor: lineColor,
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 6,
        pointHoverRadius: 4,
      },
      {
        label: 'Forecast',
        data: FORECAST_VALUES.map((value, index) =>
          chartPoint(value, RECORDED_VALUES.length - 1 + index),
        ),
        parsing: false,
        borderColor: dimColor,
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3,
        borderWidth: 2,
        borderDash: [5, 5],
        pointRadius: 0,
        pointHitRadius: 0,
        pointHoverRadius: 0,
      },
    ],
  };

  const baseConfig = createLineGraphConfig({
    showLegend: false,
    zoomMinRange: 1,
    tooltipCallbacks: {
      title: (items) => {
        const x = items[0]?.parsed?.x;
        return typeof x === 'number' ? timeLabel(x) : '';
      },
      label: (item) => {
        const value = item.parsed.y;
        if (value === null || !Number.isFinite(value)) return '';
        const region = item.datasetIndex === 1 ? 'Forecast' : 'Recorded';
        return `${region}: ${value.toFixed(1)} °C`;
      },
    },
  });

  const chartConfig = {
    ...baseConfig,
    animation: { duration: 600 },
    interaction: { mode: 'point', intersect: true },
    plugins: {
      ...baseConfig.plugins,
      tooltip: {
        ...baseConfig.plugins.tooltip,
        mode: 'point',
        intersect: true,
        filter: (item: { datasetIndex: number }) => item.datasetIndex === 0,
      },
      zoom: {
        zoom: { wheel: { enabled: false }, pinch: { enabled: false } },
        pan: { enabled: false },
      },
    },
    scales: {
      x: {
        type: 'linear',
        min: CHART_START,
        max: CHART_START + 16 * CHART_STEP_MS,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: dimColor,
          stepSize: 2 * 60 * 60 * 1000,
          maxTicksLimit: 5,
          callback: (value: number | string) => timeLabel(Number(value)),
        },
      },
      y: {
        type: 'linear',
        min: 20.4,
        max: 22.2,
        position: 'left',
        grid: { color: gridColor },
        border: { display: false },
        ticks: {
          color: dimColor,
          stepSize: 0.6,
          callback: (value: number | string) => `${Number(value).toFixed(1)}°`,
        },
      },
    },
  } as LineGraphConfig;

  return (
    <section className="landing-section" id="product" aria-labelledby="preview-title">
      <Reveal>
        <SectionHead
          id="preview-title"
          eyebrow="Inside the dashboard"
          title="The whole picture, one screen"
          lede="Read the current value, compare it with history and see where the next hour is heading without leaving the device view."
        />
      </Reveal>
      <Reveal delay={80}>
        <div className="landing-preview">
          <div className="landing-preview__bar">
            <p className="landing-preview__title">Overview</p>
            <span className="landing-preview__filter">All locations</span>
          </div>

          <div className="landing-preview__body">
            <div className="landing-preview__main">
              <div className="landing-preview__stats">
                <div className="landing-preview__stat">
                  <p className="landing-preview__stat-label">Temperature</p>
                  <p className="landing-preview__stat-value">21.4 °C</p>
                  <p className="landing-preview__stat-delta">+0.6 in 1h</p>
                </div>
                <div className="landing-preview__stat">
                  <p className="landing-preview__stat-label">Humidity</p>
                  <p className="landing-preview__stat-value">47.2 %</p>
                  <p className="landing-preview__stat-delta">−1.1 in 1h</p>
                </div>
                <div className="landing-preview__stat">
                  <p className="landing-preview__stat-label">Pressure</p>
                  <p className="landing-preview__stat-value">1012 hPa</p>
                  <p className="landing-preview__stat-delta">steady</p>
                </div>
              </div>

              <div className="landing-preview__chart">
                <div className="landing-preview__chart-head">
                  <p className="landing-preview__chart-title">Temperature</p>
                  <div className="landing-preview__legend">
                    <span className="landing-preview__legend-item">
                      <span className="landing-preview__legend-line" aria-hidden="true" />
                      Recorded
                    </span>
                    <span className="landing-preview__legend-item">
                      <span
                        className="landing-preview__legend-line landing-preview__legend-line--forecast"
                        aria-hidden="true"
                      />
                      Forecast
                    </span>
                  </div>
                </div>
                <div className="landing-preview__chart-canvas">
                  <LineGraph
                    data={chartData}
                    config={chartConfig}
                    ariaLabel="Temperature history with a short forecast"
                    summary="Recorded temperature is steady near 21 degrees, with a mild rise forecast for the next two hours."
                  />
                </div>
              </div>
            </div>

            <aside className="landing-preview__side">
              <p className="landing-preview__side-label">Devices</p>
              <ul className="landing-preview__devices">
                {DEVICES.map((device) => (
                  <li key={device.name} className="landing-preview__device">
                    <span className="landing-preview__device-name">
                      {device.name}
                      <span className="landing-preview__device-place">{device.place}</span>
                    </span>
                    <span className="landing-preview__device-reading">{device.reading}</span>
                  </li>
                ))}
              </ul>
              <div className="landing-preview__alert">
                <IconAlertTriangle {...SMALL_ICON} aria-hidden="true" />
                <span>
                  <strong>Workshop above 18 °C</strong>
                  <span>12 min ago</span>
                </span>
              </div>
            </aside>
          </div>
        </div>
        <p className="landing-preview__caption">A preview of the device view. Your devices, your readings.</p>
      </Reveal>
    </section>
  );
};

const STEPS = [
  {
    title: 'Link a device',
    body: 'Open the connect flow, enter the code shown on the sensor and pick a location. It appears in your account right away.',
  },
  {
    title: 'Collect and query',
    body: 'Readings arrive on their own. Explore them in TQL, or describe the table you want and let Iris draft it.',
  },
  {
    title: 'Watch and act',
    body: 'Follow the live view, check the forecast and route alerts to the channels your team already reads.',
  },
];

export const HowItWorks = () => (
  <section className="landing-section" aria-labelledby="how-title">
    <Reveal>
      <SectionHead
        id="how-title"
        eyebrow="How it works"
        title="Three steps from sensor to decision"
        lede="No collectors to host and no pipeline to babysit. Connect the device and Ayphr does the rest."
      />
    </Reveal>
    <div className="landing-steps">
      {STEPS.map((step, index) => (
        <Reveal key={step.title} className="landing-step" delay={index * 70}>
          <article>
            <p className="landing-step__number">{String(index + 1).padStart(2, '0')}</p>
            <h3 className="landing-step__title">{step.title}</h3>
            <p className="landing-step__body">{step.body}</p>
          </article>
        </Reveal>
      ))}
    </div>
  </section>
);

export const Hardware = () => (
  <section className="landing-section landing-hardware" id="hardware" aria-labelledby="hardware-title">
    <Reveal className="landing-hardware__copy">
      <p className="landing-eyebrow">Hardware</p>
      <h2 className="landing-heading" id="hardware-title">
        We make the sensor too.
      </h2>
      <p className="landing-lede">
        Ayphr is not only the dashboard. The first generation Geo sensor is a quiet, continuous
        node built for the same job: readings you do not have to think about.
      </p>
      <p className="landing-hardware__note">Preorders open in 2027</p>
      <Button
        href={EXTERNAL_URLS.store}
        target="_blank"
        rel="noopener noreferrer"
        variant="secondary"
      >
        Shop hardware
        <IconArrowRight {...ICON} aria-hidden="true" />
      </Button>
    </Reveal>
  </section>
);

const FAQ = [
  {
    question: 'What is Ayphr?',
    answer:
      'Ayphr is a dashboard for sensor readings. Devices send their data in, and your team reads it, queries it and acts on it from one place.',
  },
  {
    question: 'When can I get the Geo sensor?',
    answer:
      'The first generation Geo sensor opens for preorders in 2027. The store is the place to follow availability and hardware details.',
  },
  {
    question: 'How does a device get linked?',
    answer:
      'Open the connect page, enter the code shown on your device and choose a location. Ayphr confirms the link and the device starts sending readings to your account.',
  },
  {
    question: 'What is TQL?',
    answer:
      'TQL is the query language in the Queries panel. Use it to shape readings into the table or series you need. If you would rather describe the result, Iris can draft the query for you.',
  },
  {
    question: 'Can I share devices with a team?',
    answer:
      'Yes. Invite teammates, set their roles and keep an audit trail in the Team panel. Devices stay in one place for everyone who needs them.',
  },
  {
    question: 'Where do alerts go?',
    answer:
      'Email and browser push are set in the Notifications panel. Discord, Slack and custom webhooks are set in Integrations, so alerts can land where your team already works.',
  },
  {
    question: 'Do forecasts use my own history?',
    answer:
      'Yes. The Forecast tab builds a forecast from the device history you already have. Pick a history window and a horizon, and Ayphr projects the next readings from there.',
  },
];

export const Faq = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const baseId = useId();

  return (
    <section className="landing-section landing-faq" id="faq" aria-labelledby="faq-title">
      <Reveal>
        <SectionHead id="faq-title" eyebrow="Questions" title="The details, before you start" />
      </Reveal>
      <Reveal delay={80}>
        <div className="landing-faq__list">
          {FAQ.map((item, index) => {
            const isOpen = openIndex === index;
            const buttonId = `${baseId}-faq-${index}`;
            const panelId = `${baseId}-panel-${index}`;

            return (
              <div key={item.question} className="landing-faq__item">
                <h3 className="landing-faq__heading">
                  <button
                    type="button"
                    id={buttonId}
                    className="landing-faq__summary"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                  >
                    <span>{item.question}</span>
                    <IconPlus {...ICON} className="landing-faq__icon" aria-hidden="true" />
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  aria-hidden={!isOpen}
                  className={`landing-faq__panel ${isOpen ? 'is-open' : ''}`}
                >
                  <div className="landing-faq__panel-inner">
                    <p className="landing-faq__answer">{item.answer}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Reveal>
    </section>
  );
};

export const FinalCta = () => (
  <section className="landing-final" aria-labelledby="final-title">
    <Reveal className="landing-final__card">
      <h2 className="landing-heading" id="final-title">
        Start with a free account
      </h2>
      <p className="landing-lede">
        Link a device, run your first query and see every reading in one place.
      </p>
      <div className="landing-final__actions">
        <Button to="/auth/register" variant="primary">
          <span>Create free account</span>
          <IconArrowRight {...ICON} aria-hidden="true" />
        </Button>
        <Link to="/auth/login" className="landing-final__signin">
          Sign in
        </Link>
      </div>
    </Reveal>
  </section>
);

export const SiteFooter = () => {
  const year = new Date().getFullYear();

  return (
    <footer className="landing-footer">
      <div className="landing-footer__top">
        <div className="landing-footer__brand">
          <Link to="/" className="landing-brand">
            <img src={logoSvg} alt="" className="landing-brand__logo" />
            <span>Ayphr</span>
          </Link>
          <p className="landing-footer__tagline">Sensor data, without the plumbing.</p>
        </div>

        <nav className="landing-footer__links" aria-label="Footer">
          <div>
            <p className="landing-footer__label">Product</p>
            <a href="#product">Overview</a>
            <a href="#hardware">Hardware</a>
            <a href={EXTERNAL_URLS.store} target="_blank" rel="noopener noreferrer">
              Store
            </a>
          </div>
          <div>
            <p className="landing-footer__label">Resources</p>
            <a href={EXTERNAL_URLS.tqlDocs} target="_blank" rel="noopener noreferrer">
              TQL documentation
            </a>
            <Link to="/link">Connect a device</Link>
          </div>
          <div>
            <p className="landing-footer__label">Policies</p>
            <Link to="/policies/terms">Terms</Link>
            <Link to="/policies/privacy">Privacy</Link>
            <Link to="/policies/refund">Refunds</Link>
          </div>
        </nav>
      </div>

      <div className="landing-footer__bottom">
        <p>© {year} Ayphr</p>
        <Link to="/auth/login">Sign in</Link>
      </div>
    </footer>
  );
};
