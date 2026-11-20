/**
 * streetracewlc - TireModel (Modelo de Pneus Avançado)
 * Baseado na Magic Formula de Pacejka com cálculo de slip ratio longitudinal e dinâmica de tração.
 */

export interface TireParameters {
  radius: number;          // Raio do pneu em metros (ex: 0.31m para 17 polegadas)
  mass: number;            // Massa da roda em kg
  inertia: number;         // Momento de inércia da roda (0.5 * m * r^2)
  b: number;               // Rigidez (Stiffness factor)
  c: number;               // Fator de forma (Shape factor)
  d: number;               // Pico de atrito (Peak factor, ex: 1.15 a 1.4 para pneu slick/esportivo)
  e: number;               // Curvatura (Curvature factor)
  rollingResistance: number; // Coeficiente de resistência ao rolamento (ex: 0.015)
}

export class Tire {
  public params: TireParameters;
  public angularVelocity: number = 0; // rad/s
  public slipRatio: number = 0;        // longitudinal slip ratio (-1 a 1+)
  public longitudinalForce: number = 0;// Força de tração/frenagem em Newtons
  public normalForce: number = 0;      // Fz em Newtons
  public isGrounded: boolean = true;
  public temperature: number = 60;     // Temperatura do pneu em °C
  public wear: number = 0;             // Desgaste

  constructor(params?: Partial<TireParameters>) {
    const defaultParams: TireParameters = {
      radius: 0.315, // 120/70-17 ou 190/55-17 média ~31.5cm
      mass: 11.5,
      inertia: 0.5 * 11.5 * (0.315 * 0.315),
      b: 10.0,
      c: 1.65,
      d: 1.35, // Pneu esportivo de alta aderência
      e: -0.8,
      rollingResistance: 0.018,
    };
    this.params = { ...defaultParams, ...params };
  }

  /**
   * Calcula a força longitudinal usando a fórmula de Pacejka:
   * Fx = Fz * D * sin(C * atan(B*s - E*(B*s - atan(B*s))))
   */
  public update(linearSpeed: number, normalForce: number, appliedTorque: number, dt: number): number {
    this.normalForce = Math.max(0, normalForce);

    if (this.normalForce <= 0.01) {
      // Roda no ar (sem contato com solo)
      this.isGrounded = false;
      this.slipRatio = 0;
      this.longitudinalForce = 0;

      // Aceleração angular livre sob torque aplicado e atrito interno
      const angularAcc = appliedTorque / this.params.inertia;
      this.angularVelocity += angularAcc * dt;
      // Amortecimento aerodinâmico na roda no ar
      this.angularVelocity *= Math.pow(0.98, dt * 60);
      return 0;
    }

    this.isGrounded = true;
    const wheelLinearSpeed = this.angularVelocity * this.params.radius;
    const absLinearSpeed = Math.abs(linearSpeed);

    // Cálculo do Slip Ratio (deslizamento):
    // s = (r * w - v) / max(|v|, |r * w|, 0.1)
    const speedDenominator = Math.max(absLinearSpeed, Math.abs(wheelLinearSpeed), 1.0);
    this.slipRatio = (wheelLinearSpeed - linearSpeed) / speedDenominator;

    // Magic Formula de Pacejka
    const s = this.slipRatio;
    const B = this.params.b;
    const C = this.params.c;
    const D = this.params.d;
    const E = this.params.e;

    const B_s = B * s;
    const pacejkaMu = D * Math.sin(C * Math.atan(B_s - E * (B_s - Math.atan(B_s))));

    // Força longitudinal máxima baseada no peso Fz
    this.longitudinalForce = this.normalForce * pacejkaMu;

    // Adiciona resistência ao rolamento oposta ao movimento
    const rollResist = this.params.rollingResistance * this.normalForce * Math.sign(linearSpeed || 1);
    this.longitudinalForce -= rollResist;

    // Torque reativo exercido pelo chão na roda: T_chao = -Fx * r
    const reactionTorque = -this.longitudinalForce * this.params.radius;
    const netTorque = appliedTorque + reactionTorque;

    // Integração da rotação da roda
    const angularAcc = netTorque / this.params.inertia;
    this.angularVelocity += angularAcc * dt;

    // Aquece pneu em altas patinagens (burnout/derrapagem)
    const slipSpeed = Math.abs(wheelLinearSpeed - linearSpeed);
    if (slipSpeed > 2.0) {
      this.temperature = Math.min(120, this.temperature + slipSpeed * 0.02 * dt);
    } else {
      this.temperature = Math.max(50, this.temperature - 0.5 * dt);
    }

    return this.longitudinalForce;
  }

  public getSlipLinearSpeed(bikeSpeed: number): number {
    return this.angularVelocity * this.params.radius - bikeSpeed;
  }
}
