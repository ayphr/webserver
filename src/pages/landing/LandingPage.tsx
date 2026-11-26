import { Link } from 'react-router-dom';
import { IconArrowRight } from '@tabler/icons-react';
import { Button } from '../../components/common';
import { EXTERNAL_URLS } from '../../lib/externalUrls';
import logoSvg from '../../assets/logo.svg';
import heroSceneSvg from '../../assets/hero-sensor-scene.svg';
import { GlyphScene } from './GlyphScene';
import './LandingPage.css';

const ICON = { size: 18, stroke: 1.5 } as const;

export const LandingPage = () => {
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <div className="landing-nav__inner">
          <Link to="/" className="landing-brand">
            <img src={logoSvg} alt="" className="landing-brand__logo" />
            <span>Ayphr</span>
          </Link>

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
          </div>
        </div>
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

      </main>

    </div>
  );
};
