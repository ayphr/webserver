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
            <span className="landing-hero__gradient-text">Sensor Networks</span>
          </h1>

          <p className="landing-hero__subtitle">
            Reliable environmental ingestion, device telemetry, and hardware fleet management built for teams who need clean data without the overhead.
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
              Shop Hardware
            </Button>
          </div>
        </section>

        {/* Feature Highlights */}
        <section className="landing-features" aria-labelledby="features-title">
          <div className="landing-features__header">
            <h2 id="features-title" className="landing-features__heading">
              Built for real-world deployments
            </h2>
            <p className="landing-features__desc">
              Everything you need to stream, monitor, and manage your environmental hardware fleet from one dashboard.
            </p>
          </div>

          <div className="landing-features__grid">
            <Card className="landing-feature-card">
              <CardHeader>
                <div className="landing-feature-card__icon-wrap">
                  <IconActivity size={24} aria-hidden="true" />
                </div>
                <h3 className="landing-feature-card__title">Live Data Streams</h3>
              </CardHeader>
              <CardBody>
                <p className="landing-feature-card__desc">
                  Track high-frequency sensor readings, including temperature, humidity, and barometric pressure, with instant updates and clean charts.
                </p>
              </CardBody>
            </Card>

            <Card className="landing-feature-card">
              <CardHeader>
                <div className="landing-feature-card__icon-wrap">
                  <IconCpu size={24} aria-hidden="true" />
                </div>
                <h3 className="landing-feature-card__title">Token Provisioning</h3>
              </CardHeader>
              <CardBody>
                <p className="landing-feature-card__desc">
                  Register new hardware instantly using cryptographic tokens. Keep track of device health, firmware status, and connectivity offline states.
                </p>
              </CardBody>
            </Card>

            <Card className="landing-feature-card">
              <CardHeader>
                <div className="landing-feature-card__icon-wrap">
                  <IconShieldCheck size={24} aria-hidden="true" />
                </div>
                <h3 className="landing-feature-card__title">Secure Access Control</h3>
              </CardHeader>
              <CardBody>
                <p className="landing-feature-card__desc">
                  Manage team access with granular permissions. All device traffic is encrypted over TLS with strict token validation out of the box.
                </p>
              </CardBody>
            </Card>
          </div>
        </section>

        {/* CTA Banner */}
        <Card elevated className="landing-cta-banner">
          <div className="landing-cta-banner__content">
            <h2>Ready to hook up your sensors?</h2>
            <p>Access your live feeds, analyze sensor history, and provision your hardware fleet.</p>
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
