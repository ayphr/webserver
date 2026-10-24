import { Link } from 'react-router-dom';
import {
  IconActivity,
  IconArrowRight,
  IconCpu,
  IconShieldCheck,
} from '@tabler/icons-react';
import { Button, Card, CardHeader, CardBody } from '../../components/common';
import logoSvg from '../../assets/logo.svg';
import './LandingPage.css';

export const LandingPage = () => {
  return (
    <div className="landing-page">
      {/* Navigation */}
      <header className="landing-nav">
        <div className="landing-nav__inner">
          <Link to="/" className="landing-brand">
            <img src={logoSvg} alt="Ayphr Logo" className="landing-brand__logo" />
            <span>Ayphr</span>
          </Link>

          <nav className="landing-nav__links" aria-label="Main Navigation">
            <Link to="/dashboard" className="landing-nav__link">
              Dashboard
            </Link>
            <a
              href="https://store.ayphr.com"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-nav__link"
            >
              Shop Ayphr
            </a>
            <Button to="/auth/login" variant="primary">
              <span>Sign In</span>
              <IconArrowRight size={16} aria-hidden="true" />
            </Button>
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="landing-main">
        {/* Hero Section */}
        <section className="landing-hero" aria-labelledby="hero-title">
          <h1 id="hero-title" className="landing-hero__title">
            Precision Telemetry &amp;{' '}
            <span className="landing-hero__gradient-text">Device Intelligence</span>
          </h1>

          <p className="landing-hero__subtitle">
            Real-time environmental sensor pipelines, hardware telemetry ingestion, and secure
            fleet management engineered for continuous observability.
          </p>

          <div className="landing-hero__actions">
            <Button to="/auth/register" variant="primary">
              <span>Get Started</span>
              <IconArrowRight size={18} aria-hidden="true" />
            </Button>
            <Button
              href="https://store.ayphr.com"
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
            >
              Shop Now
            </Button>
          </div>
        </section>

        {/* Feature Highlights */}
        <section className="landing-features" aria-labelledby="features-title">
          <div className="landing-features__header">
            <h2 id="features-title" className="landing-features__heading">
              Engineered for telemetry at scale
            </h2>
            <p className="landing-features__desc">
              Everything required to orchestrate devices, record telemetry, and inspect environmental readings.
            </p>
          </div>

          <div className="landing-features__grid">
            <Card className="landing-feature-card">
              <CardHeader>
                <div className="landing-feature-card__icon-wrap">
                  <IconActivity size={24} aria-hidden="true" />
                </div>
                <h3 className="landing-feature-card__title">Real-time Telemetry</h3>
              </CardHeader>
              <CardBody>
                <p className="landing-feature-card__desc">
                  Collect and visualize high-frequency sensor readings including temperature, humidity, and barometric
                  pressure with zero-friction streaming.
                </p>
              </CardBody>
            </Card>

            <Card className="landing-feature-card">
              <CardHeader>
                <div className="landing-feature-card__icon-wrap">
                  <IconCpu size={24} aria-hidden="true" />
                </div>
                <h3 className="landing-feature-card__title">Fleet &amp; Token Provisioning</h3>
              </CardHeader>
              <CardBody>
                <p className="landing-feature-card__desc">
                  Register devices effortlessly using cryptographically signed authorization tokens and monitor fleet
                  health from a centralized console.
                </p>
              </CardBody>
            </Card>

            <Card className="landing-feature-card">
              <CardHeader>
                <div className="landing-feature-card__icon-wrap">
                  <IconShieldCheck size={24} aria-hidden="true" />
                </div>
                <h3 className="landing-feature-card__title">Secure &amp; Policy-Governed</h3>
              </CardHeader>
              <CardBody>
                <p className="landing-feature-card__desc">
                  Enterprise session management, granular policy enforcement gates, and transparent data privacy controls
                  built directly into the core.
                </p>
              </CardBody>
            </Card>
          </div>
        </section>

        {/* CTA Banner */}
        <Card elevated className="landing-cta-banner">
          <div className="landing-cta-banner__content">
            <h2>Ready to monitor your environment?</h2>
            <p>Access your live devices, analyze sensor data, and manage your account.</p>
          </div>
          <Button to="/auth/register" variant="primary">
            <span>Get Started</span>
            <IconArrowRight size={18} aria-hidden="true" />
          </Button>
        </Card>
      </main>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer__inner">
          <div className="landing-footer__top">
            <div className="landing-footer__brand-info">
              <img src={logoSvg} alt="Ayphr Logo" className="landing-footer__logo" />
              <span className="landing-footer__name">Ayphr</span>
            </div>

            <nav className="landing-footer__links" aria-label="Legal Links">
              <Link to="/policies/terms" className="landing-footer__link">
                Terms
              </Link>
              <Link to="/policies/privacy" className="landing-footer__link">
                Privacy Policy
              </Link>
              <Link to="/policies/refunds" className="landing-footer__link">
                Refunds
              </Link>
            </nav>
          </div>

          <div className="landing-footer__bottom">
            <span>&copy; {new Date().getFullYear()} Ayphr. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
