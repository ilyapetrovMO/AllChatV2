export class AudioGate {
  private open = true; private belowSince?: number;
  constructor(private thresholdDB: number, private holdMS = 150, private hysteresisDB = 6) {}
  observe(levelDB: number, now: number): boolean {
    if (this.open && levelDB < this.thresholdDB - this.hysteresisDB) {
      this.belowSince ??= now;
      if (now - this.belowSince >= this.holdMS) this.open = false;
    } else if (levelDB >= this.thresholdDB) { this.open = true; this.belowSince = undefined; }
    else if (this.open) this.belowSince = undefined;
    return this.open;
  }
}
