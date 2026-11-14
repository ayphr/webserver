import type { ForecastAlgorithm } from '../types';
import { AnalogKnn } from './analog';
import { LevinsonAR, RecursiveLeastSquaresAR } from './autoregressive';
import { AlphaBetaGamma, KinematicKalman } from './kalman';
import { ParticleFilter } from './particle';
import { Persistence } from './persistence';
import { BarometricAdvective, NewtonCooling, PsychrometricUkf } from './physics';
import { ExponentialSmoother, ThetaMethod } from './smoothing';
import { HarmonicOLS, SingularSpectrumAnalysis } from './spectral';

/**
 * The full algorithm bank. Each entry is an independent, online, constant-memory
 * forecaster; the arbitrator learns how much to trust each one.
 */
export function createAlgorithmBank(): ForecastAlgorithm[] {
  return [
    new Persistence(),
    new KinematicKalman('M01', 2, 0.5),
    new KinematicKalman('M02', 2, 4),
    new KinematicKalman('M03', 3, 0.5),
    new KinematicKalman('M04', 3, 4),
    new AlphaBetaGamma(),
    new ParticleFilter(),
    new NewtonCooling(),
    new PsychrometricUkf(),
    new BarometricAdvective(),
    new ExponentialSmoother({ id: 'M10', alpha: 0.3 }),
    new ExponentialSmoother({ id: 'M11', alpha: 0.4, beta: 0.05 }),
    new ExponentialSmoother({ id: 'M12', alpha: 0.4, beta: 0.05, phi: 0.98 }),
    new ExponentialSmoother({ id: 'M13', alpha: 0.4, beta: 0.02, phi: 0.99, gamma: 0.05 }),
    new ThetaMethod(),
    new HarmonicOLS(),
    new SingularSpectrumAnalysis(),
    new LevinsonAR(),
    new RecursiveLeastSquaresAR('M18', 8, 0.98),
    new RecursiveLeastSquaresAR('M19', 8, 0.999),
    new AnalogKnn(),
  ];
}

export { Persistence, KinematicKalman, AlphaBetaGamma, ParticleFilter };
export { NewtonCooling, PsychrometricUkf, BarometricAdvective };
export { ExponentialSmoother, ThetaMethod };
export { HarmonicOLS, SingularSpectrumAnalysis };
export { LevinsonAR, RecursiveLeastSquaresAR };
export { AnalogKnn };
