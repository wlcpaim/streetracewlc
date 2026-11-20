/**
 * streetracewlc - Powertrain & Transmission
 * Motor 999cc 4 cilindros em linha, curva de torque dyno, câmbio de 6 marchas e quickshifter.
 */

export interface EngineSpecs {
  idleRpm: number;
  maxRpm: number;
  limiterCutRpm: number;
  flywheelInertia: number;
  primaryRatio: number;
  finalDriveRatio: number;
  gearRatios: number[]; // [Neutro (0), 1ª, 2ª, 3ª, 4ª, 5ª, 6ª]
}

export class Powertrain {
  public specs: EngineSpecs;
  public rpm: number;
  public currentGear: number = 1; // 0 = Neutro, 1..6
  public throttle: number = 0;    // 0.0 a 1.0
  public clutch: number = 0;      // 0.0 (acoplada) a 1.0 (pressionada/desacoplada)
  public isLimiterCut: boolean = false;
  public quickshifterTimer: number = 0; // ms para corte de ignição
  public engineTorque: number = 0;
  public wheelDriveTorque: number = 0;
  public backfireEvent: boolean = false;

  constructor() {
    this.specs = {
      idleRpm: 1200,
      maxRpm: 14500,
      limiterCutRpm: 14200,
      flywheelInertia: 0.12, // kg*m^2
      primaryRatio: 1.68,
      finalDriveRatio: 2.65, // Coroa 45T / Pinhão 17T
      gearRatios: [0, 2.56, 2.05, 1.71, 1.48, 1.32, 1.20]
    };
    this.rpm = this.specs.idleRpm;
  }

  /**
   * Curva de torque baseada em motor esportivo 1000cc moderno (DOHC 16V).
   * Torque em Nm dependente do RPM.
   */
  public getNaturalTorque(rpm: number): number {
    if (rpm < 1000) return 40;
    // Curva com bom torque em média e pico estrondoso em alta
    // 3000 RPM -> ~65 Nm
    // 7000 RPM -> ~85 Nm
    // 11000 RPM -> ~116 Nm
    // 13500 RPM -> ~105 Nm
    const x = rpm / 1000;
    const curve = -0.55 * Math.pow(x - 11.2, 2) + 118;
    return Math.max(35, Math.min(120, curve));
  }

  /**
   * Atualização do ciclo de combustão e rotação do motor
   */
  public update(wheelAngularVelocity: number, dt: number): number {
    this.backfireEvent = false;

    // Gerenciamento do Quickshifter
    if (this.quickshifterTimer > 0) {
      this.quickshifterTimer -= dt;
      if (this.quickshifterTimer <= 0) {
        this.quickshifterTimer = 0;
        this.backfireEvent = true; // Estalo de escape ao religar
      }
    }

    const isCut = this.quickshifterTimer > 0 || (this.rpm >= this.specs.limiterCutRpm);
    this.isLimiterCut = isCut;

    if (this.rpm >= this.specs.limiterCutRpm) {
      this.backfireEvent = Math.random() < 0.35;
    }

    // Relação total da transmissão
    const currentGearRatio = this.specs.gearRatios[this.currentGear] || 0;
    const totalGearRatio = currentGearRatio * this.specs.primaryRatio * this.specs.finalDriveRatio;

    // RPM equivalente às rodas
    const wheelRpmEquiv = Math.abs(wheelAngularVelocity) * (60 / (2 * Math.PI)) * totalGearRatio;

    // Torque bruto gerado pela queima de combustível
    const naturalTorque = this.getNaturalTorque(this.rpm);
    const combustionTorque = isCut ? 0 : naturalTorque * this.throttle;

    // Atrito interno / freio motor
    const engineFriction = 12 + (this.rpm / 1000) * 2.8;

    if (this.currentGear === 0 || this.clutch > 0.8) {
      // Motor livre no Neutro ou embreagem apertada
      const netEngineTorque = combustionTorque - engineFriction;
      const rpmAcc = (netEngineTorque / this.specs.flywheelInertia) * (60 / (2 * Math.PI));
      this.rpm += rpmAcc * dt;
      this.wheelDriveTorque = 0;
    } else {
      // Motor engrenado com a roda traseira
      const clutchEngagement = 1.0 - this.clutch;
      const targetRpm = Math.max(this.specs.idleRpm, wheelRpmEquiv);
      
      // Amortecimento e transição de rotação acoplada
      this.rpm += (targetRpm - this.rpm) * Math.min(1.0, dt * 25 * clutchEngagement);

      if (isCut) {
        this.rpm -= 3500 * dt; // Queda rápida com corte
      }

      // Torque entregue à roda traseira = (Torque do motor - atrito) * relação total * eficiência
      const transmissionEfficiency = 0.94;
      const netTorque = (combustionTorque - engineFriction * 0.5);
      this.wheelDriveTorque = netTorque * totalGearRatio * transmissionEfficiency * clutchEngagement;
    }

    // Limitador de teto e marcha lenta
    if (this.rpm > this.specs.maxRpm) {
      this.rpm = this.specs.maxRpm;
    }
    if (this.rpm < this.specs.idleRpm) {
      this.rpm = this.specs.idleRpm;
    }

    this.engineTorque = combustionTorque;
    return this.wheelDriveTorque;
  }

  public shiftUp(): boolean {
    if (this.currentGear < 6) {
      this.currentGear++;
      this.quickshifterTimer = 0.065; // 65ms de corte rápido
      return true;
    }
    return false;
  }

  public shiftDown(): boolean {
    if (this.currentGear > 1) {
      this.currentGear--;
      // Auto-blipper: leve aceleração na redução
      this.rpm = Math.min(this.specs.maxRpm - 1000, this.rpm + 1500);
      return true;
    } else if (this.currentGear === 1) {
      this.currentGear = 0; // Neutro
      return true;
    }
    return false;
  }

  public shiftTo(gear: number): void {
    if (gear >= 0 && gear <= 6) {
      this.currentGear = gear;
    }
  }

  public getHorsepower(): number {
    // HP = (Torque [Nm] * RPM) / 7127
    const torque = this.getNaturalTorque(this.rpm);
    return ((torque * this.rpm) / 7127) * this.throttle;
  }
}
