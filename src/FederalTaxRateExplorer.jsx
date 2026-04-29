import React, { useCallback, useMemo, useRef, useState } from "react";

// ============================================================================
// 2025 TAX DATA
// Sources noted in original app comments: IRS Rev. Proc. 2024-40, OBBB Act adjustments, IRS Topic 409
// ============================================================================

const STANDARD_DEDUCTION_2025 = {
  single: 15750,
  mfj: 31500,
  hoh: 23625,
};

// Ordinary income brackets — taxable income thresholds after standard deduction.
// Format: [upper bound of bracket, marginal rate]
const ORDINARY_BRACKETS_2025 = {
  single: [
    [11925, 0.1],
    [48475, 0.12],
    [103350, 0.22],
    [197300, 0.24],
    [250525, 0.32],
    [626350, 0.35],
    [Infinity, 0.37],
  ],
  mfj: [
    [23850, 0.1],
    [96950, 0.12],
    [206700, 0.22],
    [394600, 0.24],
    [501050, 0.32],
    [751600, 0.35],
    [Infinity, 0.37],
  ],
  hoh: [
    [17000, 0.1],
    [64850, 0.12],
    [103350, 0.22],
    [197300, 0.24],
    [250500, 0.32],
    [626350, 0.35],
    [Infinity, 0.37],
  ],
};

// Long-term capital gains brackets — based on total taxable income.
// Format: [upper bound of taxable income, rate]
const CAPGAINS_BRACKETS_2025 = {
  single: [
    [48350, 0],
    [533400, 0.15],
    [Infinity, 0.2],
  ],
  mfj: [
    [96700, 0],
    [600050, 0.15],
    [Infinity, 0.2],
  ],
  hoh: [
    [64750, 0],
    [566700, 0.15],
    [Infinity, 0.2],
  ],
};

const FILING_LABEL = {
  single: "Single",
  mfj: "Married Filing Jointly",
  hoh: "Head of Household",
};

const VIEW_LABEL = {
  individual: "Bracket Stack",
  aggregate: "Rate Curves",
};

const COLORS = {
  page: "#f3f5f8",
  card: "#ffffff",
  text: "#0f172a",
  muted: "#64748b",
  softText: "#334155",
  border: "#d8dee9",
  strongBorder: "#b9c4d4",
  primary: "#102a56",
  primarySoft: "#eef4ff",
  ordinary: "#243447",
  capitalGains: "#047857",
  capitalSoft: "#ecfdf5",
  effective: "#b42318",
  effectiveSoft: "#fff1f0",
  grid: "#edf1f7",
  axis: "#5d6b82",
};

const ORD_COLORS = ["#f8fafc", "#e8eef8", "#d5e0f3", "#b7c9eb", "#8faee1", "#5278ca", "#263f8f"];
const CG_COLORS = ["#effdf7", "#a9eccc", "#158a63"];

// ============================================================================
// TAX CALCULATIONS
// ============================================================================

function calcOrdinaryTax(taxableIncome, brackets) {
  if (taxableIncome <= 0) {
    return {
      totalTax: 0,
      perBracket: brackets.map(([, rate]) => ({
        rate,
        taxedAmount: 0,
        taxOnBracket: 0,
        lower: 0,
        upper: 0,
      })),
    };
  }

  let prev = 0;
  let totalTax = 0;
  const perBracket = [];

  for (const [upper, rate] of brackets) {
    const top = Math.min(taxableIncome, upper);
    const taxed = Math.max(0, top - prev);
    const tax = taxed * rate;
    totalTax += tax;
    perBracket.push({ rate, taxedAmount: taxed, taxOnBracket: tax, lower: prev, upper });
    prev = upper;

    if (taxableIncome <= upper) {
      for (let i = perBracket.length; i < brackets.length; i += 1) {
        const [u, r] = brackets[i];
        perBracket.push({ rate: r, taxedAmount: 0, taxOnBracket: 0, lower: prev, upper: u });
        prev = u;
      }
      break;
    }
  }

  return { totalTax, perBracket };
}

function calcCapGainsTax(ordinaryTaxable, gains, cgBrackets) {
  if (gains <= 0) {
    return {
      totalTax: 0,
      perBracket: cgBrackets.map(([, rate]) => ({ rate, taxedAmount: 0, taxOnBracket: 0 })),
    };
  }

  let totalTax = 0;
  const perBracket = [];
  let remaining = gains;
  let cursor = ordinaryTaxable;

  for (const [upper, rate] of cgBrackets) {
    if (remaining <= 0) {
      perBracket.push({ rate, taxedAmount: 0, taxOnBracket: 0, lower: cursor, upper });
      continue;
    }

    const room = Math.max(0, upper - cursor);
    const taxed = Math.min(remaining, room);
    const tax = taxed * rate;
    totalTax += tax;
    perBracket.push({ rate, taxedAmount: taxed, taxOnBracket: tax, lower: cursor, upper });
    cursor += taxed;
    remaining -= taxed;
  }

  return { totalTax, perBracket };
}

function computeTax(gross, regularPct, filing) {
  const stdDed = STANDARD_DEDUCTION_2025[filing];
  const regularGross = gross * (regularPct / 100);
  const capGainsGross = gross * (1 - regularPct / 100);

  // Standard deduction reduces ordinary income first.
  const ordinaryTaxable = Math.max(0, regularGross - stdDed);
  const deductionRemaining = Math.max(0, stdDed - regularGross);
  const capGainsTaxable = Math.max(0, capGainsGross - deductionRemaining);

  const ordRes = calcOrdinaryTax(ordinaryTaxable, ORDINARY_BRACKETS_2025[filing]);
  const cgRes = calcCapGainsTax(ordinaryTaxable, capGainsTaxable, CAPGAINS_BRACKETS_2025[filing]);

  const totalTax = ordRes.totalTax + cgRes.totalTax;

  return {
    gross,
    regularGross,
    capGainsGross,
    stdDed,
    ordinaryTaxable,
    capGainsTaxable,
    ordRes,
    cgRes,
    totalTax,
    avgRate: gross > 0 ? totalTax / gross : 0,
  };
}

function capGainsTaxable(stdDed, regularGross, capGainsGross) {
  const deductionRemaining = Math.max(0, stdDed - regularGross);
  return Math.max(0, capGainsGross - deductionRemaining);
}

function getMarginalRates(gross, regularPct, filing) {
  const ord = ORDINARY_BRACKETS_2025[filing];
  const cg = CAPGAINS_BRACKETS_2025[filing];
  const stdDed = STANDARD_DEDUCTION_2025[filing];
  const regularGross = gross * (regularPct / 100);
  const capGainsGross = gross * (1 - regularPct / 100);
  const ordinaryTaxable = Math.max(0, regularGross - stdDed);

  let ordRate = 0;
  if (regularGross > stdDed) {
    for (const [upper, rate] of ord) {
      if (ordinaryTaxable <= upper) {
        ordRate = rate;
        break;
      }
    }
  }

  let cgRate = 0;
  if (capGainsGross > 0) {
    const cgStackPos = ordinaryTaxable + 1;
    for (const [upper, rate] of cg) {
      if (cgStackPos <= upper) {
        cgRate = rate;
        break;
      }
    }
  }

  const blended = (regularPct / 100) * ordRate + (1 - regularPct / 100) * cgRate;
  return { ordRate, cgRate, blended };
}

// ============================================================================
// CHART HELPERS — log scale
// ============================================================================

const X_MIN = 10000;
const X_MAX = 3_000_000;
const LOG_MIN = Math.log10(X_MIN);
const LOG_MAX = Math.log10(X_MAX);

function xToPx(x, width, padLeft, padRight) {
  const usable = width - padLeft - padRight;
  const t = (Math.log10(Math.max(x, X_MIN)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  return padLeft + t * usable;
}

function pxToX(px, width, padLeft, padRight) {
  const usable = width - padLeft - padRight;
  const t = (px - padLeft) / usable;
  return Math.pow(10, LOG_MIN + t * (LOG_MAX - LOG_MIN));
}

function yToPx(yPct, height, padTop, padBottom, yMaxPct) {
  const usable = height - padTop - padBottom;
  return padTop + usable - (yPct / yMaxPct) * usable;
}

function formatMoney(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function formatMoneyFull(n) {
  return `$${Math.round(n).toLocaleString()}`;
}

function generateLogTicks() {
  const ticks = [];
  for (let mag = LOG_MIN; mag <= LOG_MAX; mag += 1) {
    const base = Math.pow(10, mag);
    for (let m = 1; m <= 9; m += 1) {
      const v = base * m;
      if (v >= X_MIN && v <= X_MAX) {
        ticks.push({
          value: v,
          major: m === 1,
          label: m === 1 ? formatMoney(v) : String(m),
        });
      }
    }
  }
  return ticks;
}

function clampPct(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function FederalTaxRateExplorer() {
  const [filing, setFiling] = useState("single");
  const [view, setView] = useState("individual");
  const [regularPct, setRegularPct] = useState(100);
  const [hoverIncome, setHoverIncome] = useState(150000);
  const [pinned, setPinned] = useState(false);

  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(1100);

  React.useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") return undefined;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.max(360, entry.contentRect.width));
      }
    });

    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const isCompact = containerWidth < 760;
  const W = Math.max(360, containerWidth - (isCompact ? 32 : 48));
  const H = Math.max(390, Math.min(540, W * 0.5));
  const padL = isCompact ? 48 : 64;
  const padR = isCompact ? 16 : 28;
  const padT = 24;
  const padB = 82;

  const ticks = useMemo(() => generateLogTicks(), []);

  const snapshot = useMemo(() => computeTax(hoverIncome, regularPct, filing), [hoverIncome, regularPct, filing]);
  const marginal = useMemo(() => getMarginalRates(hoverIncome, regularPct, filing), [hoverIncome, regularPct, filing]);

  const samples = useMemo(() => {
    const N = 260;
    const arr = [];
    for (let i = 0; i <= N; i += 1) {
      const t = i / N;
      const x = Math.pow(10, LOG_MIN + t * (LOG_MAX - LOG_MIN));
      arr.push(x);
    }
    return arr;
  }, []);

  const individualData = useMemo(() => {
    const ordBrackets = ORDINARY_BRACKETS_2025[filing];
    const cgBrackets = CAPGAINS_BRACKETS_2025[filing];
    const stdDed = STANDARD_DEDUCTION_2025[filing];

    return samples.map((x) => {
      const regGross = x * (regularPct / 100);
      const cgGross = x * (1 - regularPct / 100);
      const ordTaxable = Math.max(0, regGross - stdDed);
      const dedRemaining = Math.max(0, stdDed - regGross);
      const cgTaxable = Math.max(0, cgGross - dedRemaining);
      const dedUsed = Math.min(stdDed, x);

      const ordBands = [];
      let prev = 0;
      let rem = ordTaxable;
      for (const [upper, rate] of ordBrackets) {
        const room = upper - prev;
        const slice = Math.max(0, Math.min(rem, room));
        ordBands.push({ rate, amount: slice });
        rem -= slice;
        prev = upper;
        if (rem <= 0) {
          for (let j = ordBands.length; j < ordBrackets.length; j += 1) {
            ordBands.push({ rate: ordBrackets[j][1], amount: 0 });
          }
          break;
        }
      }

      const cgBands = [];
      let cgRem = cgTaxable;
      let cursor = ordTaxable;
      for (const [upper, rate] of cgBrackets) {
        const room = Math.max(0, upper - cursor);
        const slice = Math.max(0, Math.min(cgRem, room));
        cgBands.push({ rate, amount: slice });
        cgRem -= slice;
        cursor += slice;
        if (cgRem <= 0) {
          for (let j = cgBands.length; j < cgBrackets.length; j += 1) {
            cgBands.push({ rate: cgBrackets[j][1], amount: 0 });
          }
          break;
        }
      }

      return { x, dedUsed, ordBands, cgBands };
    });
  }, [samples, filing, regularPct]);

  const stackedPaths = useMemo(() => {
    const bandsCount = 1 + ORDINARY_BRACKETS_2025[filing].length + CAPGAINS_BRACKETS_2025[filing].length;
    const cumulatives = individualData.map((d) => {
      const cum = [0];
      let acc = (d.dedUsed / d.x) * 100;
      cum.push(acc);
      for (const b of d.ordBands) {
        acc += (b.amount / d.x) * 100;
        cum.push(acc);
      }
      for (const b of d.cgBands) {
        acc += (b.amount / d.x) * 100;
        cum.push(acc);
      }
      return cum;
    });

    const paths = [];
    for (let i = 0; i < bandsCount; i += 1) {
      let d = "";
      for (let s = 0; s < individualData.length; s += 1) {
        const x = individualData[s].x;
        const yTop = cumulatives[s][i + 1];
        const px = xToPx(x, W, padL, padR);
        const py = yToPx(yTop, H, padT, padB, 100);
        d += s === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
      }
      for (let s = individualData.length - 1; s >= 0; s -= 1) {
        const x = individualData[s].x;
        const yBot = cumulatives[s][i];
        const px = xToPx(x, W, padL, padR);
        const py = yToPx(yBot, H, padT, padB, 100);
        d += ` L ${px} ${py}`;
      }
      d += " Z";
      paths.push(d);
    }
    return paths;
  }, [individualData, W, H, filing, padL, padR, padB]);

  const aggData = useMemo(
    () =>
      samples.map((x) => {
        const m = getMarginalRates(x, regularPct, filing);
        const t = computeTax(x, regularPct, filing);
        return {
          x,
          ordMarg: m.ordRate * 100,
          cgMarg: m.cgRate * 100,
          blended: m.blended * 100,
          avg: t.avgRate * 100,
        };
      }),
    [samples, regularPct, filing],
  );

  const aggYMax = 40;

  const buildLinePath = useCallback(
    (data, key) => {
      let d = "";
      data.forEach((p, i) => {
        const px = xToPx(p.x, W, padL, padR);
        const py = yToPx(p[key], H, padT, padB, aggYMax);
        d += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
      });
      return d;
    },
    [W, H, padL, padR, padB],
  );

  const handleMove = useCallback(
    (evt) => {
      if (pinned || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const px = ((evt.clientX - rect.left) / rect.width) * W;
      if (px < padL || px > W - padR) return;
      setHoverIncome(pxToX(px, W, padL, padR));
    },
    [pinned, W, padL, padR],
  );

  const handleClick = useCallback(
    (evt) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const px = ((evt.clientX - rect.left) / rect.width) * W;
      if (px < padL || px > W - padR) return;
      setHoverIncome(pxToX(px, W, padL, padR));
      setPinned((p) => !p);
    },
    [W, padL, padR],
  );

  const setIncomeMixFromOrdinary = useCallback((value) => {
    setRegularPct(clampPct(value));
  }, []);

  const setIncomeMixFromCapitalGains = useCallback((value) => {
    setRegularPct(100 - clampPct(value));
  }, []);

  const cursorPx = xToPx(hoverIncome, W, padL, padR);

  return (
    <main ref={containerRef} style={styles.pageShell}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
      />

      <header style={styles.hero}>
        <div>
          <div style={styles.eyebrow}>Federal Income Tax · 2025 Tax Year</div>
          <h1 style={styles.title}>Federal Tax Rate Explorer</h1>
          <p style={styles.subtitle}>
            Model ordinary income, long-term capital gains, marginal rates, and effective federal tax rates under the
            selected filing status and income mix.
          </p>
        </div>
        <div style={styles.headerBadge}>
          <span style={styles.headerBadgeLabel}>Selected income</span>
          <strong style={styles.headerBadgeValue}>{formatMoneyFull(hoverIncome)}</strong>
          <span style={styles.headerBadgeHint}>{pinned ? "Pinned" : "Hover chart to inspect"}</span>
        </div>
      </header>

      <section style={styles.controlCard} aria-label="Tax explorer controls">
        <div style={styles.controlGroupWide}>
          <ControlLabel label="Filing status" />
          <SelectControl
            value={filing}
            onChange={setFiling}
            options={[
              { value: "single", label: "Single" },
              { value: "mfj", label: "Married Filing Jointly" },
              { value: "hoh", label: "Head of Household" },
            ]}
          />
        </div>

        <div style={styles.controlGroupWide}>
          <ControlLabel label="View" />
          <SegmentedControl
            value={view}
            onChange={setView}
            options={[
              { value: "individual", label: "Bracket Stack" },
              { value: "aggregate", label: "Rate Curves" },
            ]}
          />
        </div>

        <div style={styles.sliderControl}>
          <div style={styles.sliderTopRow}>
            <ControlLabel label="Income mix" />
            <span style={styles.mixReadout}>
              <span style={{ color: COLORS.ordinary }}>{regularPct}% ordinary</span>
              <span style={styles.mixDivider}>/</span>
              <span style={{ color: COLORS.capitalGains }}>{100 - regularPct}% capital gains</span>
            </span>
          </div>

          <div style={styles.mixInputs}>
            <PercentInput
              label="Ordinary income"
              value={regularPct}
              color={COLORS.ordinary}
              onChange={setIncomeMixFromOrdinary}
            />
            <PercentInput
              label="Capital gains"
              value={100 - regularPct}
              color={COLORS.capitalGains}
              onChange={setIncomeMixFromCapitalGains}
            />
          </div>

          <div style={styles.sliderRow}>
            <span style={styles.sliderEndLabel}>Ordinary</span>
            <input
              aria-label="Ordinary income percentage"
              type="range"
              min={0}
              max={100}
              value={regularPct}
              onChange={(e) => setRegularPct(Number(e.target.value))}
              style={styles.range}
            />
            <span style={styles.sliderEndLabel}>Capital gains</span>
          </div>
        </div>
      </section>

      <section style={styles.kpiGrid} aria-label="Selected tax summary">
        <MetricCard label="Total federal tax" value={formatMoneyFull(snapshot.totalTax)} tone="primary" />
        <MetricCard label="Effective rate" value={`${(snapshot.avgRate * 100).toFixed(2)}%`} tone="effective" />
        <MetricCard label="Blended marginal" value={`${(marginal.blended * 100).toFixed(2)}%`} tone="ordinary" />
        <MetricCard label="After-tax income" value={formatMoneyFull(snapshot.gross - snapshot.totalTax)} tone="capital" />
      </section>

      <section style={styles.chartCard}>
        <div style={styles.chartHeader}>
          <div>
            <h2 style={styles.cardTitle}>Tax rate profile</h2>
            <p style={styles.cardSubtitle}>
              {view === "individual"
                ? "Use the aligned rate guide above the chart to see how ordinary-income brackets line up with the shaded regions below."
                : "Shows marginal, blended marginal, and average effective tax rates."}
            </p>
          </div>
          <div style={styles.chartPill}>{VIEW_LABEL[view]}</div>
        </div>

        <ChartMetaRow
          filing={filing}
          regularPct={regularPct}
          view={view}
        />

        {view === "individual" && (
          <BracketLabelRows
            filing={filing}
            regularPct={regularPct}
            chartWidth={W}
            padLeft={padL}
            padRight={padR}
          />
        )}

        <div style={styles.chartWrap}>
          <svg
            ref={svgRef}
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            style={{ ...styles.svg, cursor: pinned ? "default" : "crosshair" }}
            onMouseMove={handleMove}
            onClick={handleClick}
            role="img"
            aria-label="Interactive tax rate chart"
          >
            <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="#fbfdff" stroke={COLORS.border} />

            {ticks.map((t, i) => {
              const px = xToPx(t.value, W, padL, padR);
              return (
                <line
                  key={`grid-${i}`}
                  x1={px}
                  x2={px}
                  y1={padT}
                  y2={H - padB}
                  stroke={t.major ? COLORS.grid : "#f8fafc"}
                  strokeWidth={t.major ? 1 : 0.6}
                />
              );
            })}

            {view === "individual" ? (
              <>
                <path d={stackedPaths[0]} fill="#ffffff" stroke="none" />
                {ORDINARY_BRACKETS_2025[filing].map((_, i) => (
                  <path key={`ord-${i}`} d={stackedPaths[1 + i]} fill={ORD_COLORS[i]} stroke="none" />
                ))}
                {CAPGAINS_BRACKETS_2025[filing].map((_, i) => (
                  <path
                    key={`cg-${i}`}
                    d={stackedPaths[1 + ORDINARY_BRACKETS_2025[filing].length + i]}
                    fill={CG_COLORS[i]}
                    stroke="none"
                    opacity={0.95}
                  />
                ))}

              </>
            ) : (
              <>
                {[5, 10, 15, 20, 25, 30, 35, 40].map((y) => {
                  const py = yToPx(y, H, padT, padB, aggYMax);
                  return (
                    <g key={`hgrid-${y}`}>
                      <line x1={padL} x2={W - padR} y1={py} y2={py} stroke={COLORS.grid} strokeDasharray="3,4" />
                      <text x={padL - 8} y={py + 4} textAnchor="end" style={styles.axisTick}>
                        {y}%
                      </text>
                    </g>
                  );
                })}

                {(() => {
                  const stdDed = STANDARD_DEDUCTION_2025[filing];
                  const grossAtDed = regularPct > 0 ? stdDed / (regularPct / 100) : 0;
                  if (grossAtDed < X_MIN || grossAtDed > X_MAX) return null;
                  const px = xToPx(grossAtDed, W, padL, padR);
                  return (
                    <line
                      x1={px}
                      x2={px}
                      y1={padT}
                      y2={H - padB}
                      stroke={COLORS.capitalGains}
                      strokeDasharray="4,4"
                      strokeWidth={1.25}
                    />
                  );
                })()}

                <path d={buildLinePath(aggData, "cgMarg")} fill="none" stroke={COLORS.capitalGains} strokeWidth={2.2} />
                <path d={buildLinePath(aggData, "ordMarg")} fill="none" stroke={COLORS.ordinary} strokeWidth={2.2} />
                <path d={buildLinePath(aggData, "blended")} fill="none" stroke={COLORS.primary} strokeWidth={2.4} strokeDasharray="7,5" />
                <path d={buildLinePath(aggData, "avg")} fill="none" stroke={COLORS.effective} strokeWidth={2.8} />
              </>
            )}

            <line x1={cursorPx} x2={cursorPx} y1={padT} y2={H - padB} stroke={COLORS.text} strokeWidth={1} strokeDasharray="4,4" opacity={0.7} />
            <g>
              <rect x={cursorPx - 43} y={H - padB + 8} width={86} height={22} rx={6} fill={COLORS.text} />
              <text x={cursorPx} y={H - padB + 23} textAnchor="middle" style={styles.cursorText}>
                {formatMoneyFull(hoverIncome)}
              </text>
            </g>

            {ticks
              .filter((t) => t.major || (t.value < X_MAX && t.label !== ""))
              .map((t, i) => {
                const px = xToPx(t.value, W, padL, padR);
                return (
                  <text
                    key={`tick-${i}`}
                    x={px}
                    y={H - padB + 48}
                    textAnchor="middle"
                    style={t.major ? styles.axisTickMajor : styles.axisTickMinor}
                  >
                    {t.label}
                  </text>
                );
              })}

            <text x={-(H / 2)} y={18} transform="rotate(-90)" textAnchor="middle" style={styles.axisLabel}>
              {view === "individual" ? "% OF GROSS INCOME" : "TAX RATE (%)"}
            </text>
            <text x={W / 2} y={H - 18} textAnchor="middle" style={styles.axisLabel}>
              GROSS INCOME ($) · LOG SCALE
            </text>

            {view === "individual" &&
              [0, 20, 40, 60, 80, 100].map((y) => {
                const py = yToPx(y, H, padT, padB, 100);
                return (
                  <text key={`ytick-${y}`} x={padL - 8} y={py + 4} textAnchor="end" style={styles.axisTick}>
                    {y}%
                  </text>
                );
              })}
          </svg>

          <div style={styles.pinInstruction}>{pinned ? "Pinned · click chart to unpin" : "Hover to inspect · click to pin"}</div>
        </div>

        {view === "aggregate" && (
          <div style={styles.legendRow}>
            <LegendLine color={COLORS.ordinary} label="Ordinary marginal" />
            <LegendLine color={COLORS.capitalGains} label="Capital gains marginal" />
            <LegendLine color={COLORS.primary} label="Blended marginal" dashed />
            <LegendLine color={COLORS.effective} label="Average effective" />
            <LegendLine color={COLORS.capitalGains} label="Standard deduction threshold" dashed />
          </div>
        )}
      </section>

      <section style={styles.detailGrid}>
        <div style={styles.card}>
          <div style={styles.cardKicker}>Selected income profile</div>
          <div style={styles.profileHeader}>
            <div>
              <div style={styles.profileIncome}>{formatMoneyFull(hoverIncome)}</div>
              <div style={styles.profileSub}>{FILING_LABEL[filing]} · {regularPct}% ordinary / {100 - regularPct}% capital gains</div>
            </div>
          </div>

          <div style={styles.summaryRows}>
            <SummaryRow label="Regular marginal rate" value={`${(marginal.ordRate * 100).toFixed(0)}%`} />
            <SummaryRow label="Capital gains marginal rate" value={`${(marginal.cgRate * 100).toFixed(0)}%`} />
            <SummaryRow label="Blended marginal rate" value={`${(marginal.blended * 100).toFixed(2)}%`} emphasized />
            <SummaryRow label="Standard deduction" value={formatMoneyFull(snapshot.stdDed)} />
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardKicker}>Bracket breakdown</div>
          {snapshot.regularGross > 0 && (
            <BreakdownSection
              title={`Ordinary income · ${formatMoneyFull(snapshot.regularGross)}`}
              color={COLORS.primary}
              rows={[
                {
                  label: "Standard deduction used",
                  value: `${formatMoneyFull(Math.min(snapshot.stdDed, snapshot.regularGross))} untaxed`,
                },
                ...snapshot.ordRes.perBracket
                  .filter((b) => b.taxedAmount > 0)
                  .map((b) => ({
                    label: `${formatMoneyFull(b.taxedAmount)} @ ${(b.rate * 100).toFixed(0)}%`,
                    value: formatMoneyFull(b.taxOnBracket),
                  })),
              ]}
            />
          )}
          {snapshot.capGainsGross > 0 && (
            <BreakdownSection
              title={`Long-term capital gains · ${formatMoneyFull(snapshot.capGainsGross)}`}
              color={COLORS.capitalGains}
              rows={
                snapshot.cgRes.perBracket.filter((b) => b.taxedAmount > 0).length > 0
                  ? snapshot.cgRes.perBracket
                      .filter((b) => b.taxedAmount > 0)
                      .map((b) => ({
                        label: `${formatMoneyFull(b.taxedAmount)} @ ${(b.rate * 100).toFixed(0)}%`,
                        value: formatMoneyFull(b.taxOnBracket),
                      }))
                  : [{ label: "Capital gains tax", value: "Absorbed by deduction or 0% bracket" }]
              }
            />
          )}
        </div>
      </section>

      <details style={styles.detailsBox}>
        <summary style={styles.detailsSummary}>Methodology & assumptions</summary>
        <div style={styles.detailsContent}>
          <p>
            This tool models federal income tax using the standard deduction, ordinary income brackets, and long-term
            capital gains brackets for the selected filing status. Ordinary income is reduced by the standard deduction
            first; any remaining deduction reduces capital gains. Capital gains then stack on top of ordinary taxable
            income for bracket purposes.
          </p>
          <p>
            Results are federal-only and exclude payroll taxes, state tax, NIIT, credits, itemized deductions, AMT,
            phaseouts, qualified dividends nuance, and other planning variables. Changing the income mix illustrates how
            ordinary income and long-term capital gains may produce different marginal and effective rate profiles.
          </p>
        </div>
      </details>

      <details style={styles.detailsBox}>
        <summary style={styles.detailsSummary}>2025 tax bracket reference</summary>
        <div style={styles.referenceIntro}>
          <div>
            <strong>{FILING_LABEL[filing]}</strong>
            <span> · Standard deduction {formatMoneyFull(STANDARD_DEDUCTION_2025[filing])}</span>
          </div>
        </div>

        <div style={styles.referenceGrid}>
          <BracketsTable
            title="Ordinary income"
            accent={COLORS.primary}
            note="Applied to taxable income after the standard deduction."
            rows={ORDINARY_BRACKETS_2025[filing].map(([upper, rate], i, arr) => ({
              lower: i === 0 ? 0 : arr[i - 1][0],
              upper,
              rate,
              color: ORD_COLORS[i],
            }))}
          />
          <BracketsTable
            title="Long-term capital gains"
            accent={COLORS.capitalGains}
            note="Bracket determined by total taxable income."
            rows={CAPGAINS_BRACKETS_2025[filing].map(([upper, rate], i, arr) => ({
              lower: i === 0 ? 0 : arr[i - 1][0],
              upper,
              rate,
              color: CG_COLORS[i],
            }))}
          />
        </div>

        <div style={styles.glanceTableWrap}>
          <h3 style={styles.smallSectionTitle}>All filing statuses at a glance</h3>
          <div style={styles.tableShell}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Filing status</th>
                  <th style={styles.th}>Standard deduction</th>
                  <th style={styles.th}>Top 37% bracket starts</th>
                  <th style={styles.th}>15% LTCG starts</th>
                  <th style={styles.th}>20% LTCG starts</th>
                </tr>
              </thead>
              <tbody>
                {["single", "mfj", "hoh"].map((f, i) => (
                  <tr key={f} style={{ ...styles.tr, background: f === filing ? COLORS.primarySoft : "transparent" }}>
                    <td style={styles.td}>{f === filing ? "▸ " : ""}{FILING_LABEL[f]}</td>
                    <td style={styles.tdMono}>{formatMoneyFull(STANDARD_DEDUCTION_2025[f])}</td>
                    <td style={styles.tdMono}>{formatMoneyFull(ORDINARY_BRACKETS_2025[f][ORDINARY_BRACKETS_2025[f].length - 2][0])}</td>
                    <td style={styles.tdMono}>{formatMoneyFull(CAPGAINS_BRACKETS_2025[f][0][0])}</td>
                    <td style={styles.tdMono}>{formatMoneyFull(CAPGAINS_BRACKETS_2025[f][1][0])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={styles.sourceNote}>
            Bracket thresholds shown are taxable income thresholds for ordinary rates; long-term capital gains thresholds
            are based on total taxable income.
          </p>
        </div>
      </details>
    </main>
  );
}

function getOrdinaryBracketLabelData(filing, regularPct) {
  if (regularPct <= 0) return [];

  return ORDINARY_BRACKETS_2025[filing].map(([upper, rate], i, arr) => {
    const lower = i === 0 ? 0 : arr[i - 1][0];
    const lowerGross = Math.max(X_MIN, (lower + STANDARD_DEDUCTION_2025[filing]) / (regularPct / 100));
    const rawUpperGross = upper === Infinity ? X_MAX : (upper + STANDARD_DEDUCTION_2025[filing]) / (regularPct / 100);
    const upperGross = Math.min(X_MAX, Math.max(lowerGross * 1.04, rawUpperGross));
    return { rate, lowerGross, upperGross, color: ORD_COLORS[i], textColor: i >= 5 ? "#ffffff" : "#0f172a" };
  });
}

function getCapitalGainsBracketLabelData(filing, regularPct) {
  if (regularPct >= 100) return [];

  return CAPGAINS_BRACKETS_2025[filing].map(([upper, rate], i, arr) => {
    const lower = i === 0 ? 0 : arr[i - 1][0];
    const lowerGross = Math.max(X_MIN, lower + STANDARD_DEDUCTION_2025[filing]);
    const rawUpperGross = upper === Infinity ? X_MAX : upper + STANDARD_DEDUCTION_2025[filing];
    const upperGross = Math.min(X_MAX, Math.max(lowerGross * 1.04, rawUpperGross));
    return { rate, lowerGross, upperGross, color: CG_COLORS[i], textColor: i >= 2 ? "#ffffff" : "#064e3b" };
  });
}

function BracketLabelRows({ filing, regularPct, chartWidth, padLeft, padRight }) {
  const ordinaryLabels = getOrdinaryBracketLabelData(filing, regularPct);
  const capitalLabels = getCapitalGainsBracketLabelData(filing, regularPct);

  const renderAlignedTrack = (items, tone, title) => (
    <div style={styles.bracketAlignedRow}>
      <div style={{ ...styles.bracketAlignedTitle, color: tone }}>{title}</div>
      <div style={{ ...styles.bracketTrack, width: chartWidth }}>
        <div style={{ ...styles.bracketTrackPlot, left: padLeft, right: padRight }} />
        {items.map((item, index) => {
          const centerGross = Math.sqrt(item.lowerGross * item.upperGross);
          const centerPx = xToPx(centerGross, chartWidth, padLeft, padRight);
          return (
            <span
              key={`${title}-chip-${index}`}
              style={{
                ...styles.bracketAlignedChip,
                left: centerPx,
                background: item.color,
                color: item.textColor,
              }}
              title={item.upperGross >= X_MAX ? `Applies roughly above ${formatMoneyFull(item.lowerGross)} gross income` : `Applies roughly from ${formatMoneyFull(item.lowerGross)} to ${formatMoneyFull(item.upperGross)} gross income`}
            >
              {Math.round(item.rate * 100)}%
            </span>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={styles.bracketRowsWrap}>
      {capitalLabels.length > 0 && renderAlignedTrack(capitalLabels, COLORS.capitalGains, 'Capital gains')}
      {ordinaryLabels.length > 0 && renderAlignedTrack(ordinaryLabels, COLORS.primary, 'Ordinary income')}
    </div>
  );
}

function ChartMetaRow({ filing, regularPct, view }) {
  return (
    <div style={styles.chartMetaRow}>
      <span style={styles.chartMetaChip}>2025 federal</span>
      <span style={styles.chartMetaChip}>{FILING_LABEL[filing]}</span>
      <span style={styles.chartMetaChip}>{regularPct}% ordinary / {100 - regularPct}% capital gains</span>
      <span style={styles.chartMetaChip}>{view === "individual" ? "Bracket stack" : "Rate curves"}</span>
      <span style={styles.chartMetaChip}>Log income scale</span>
    </div>
  );
}

function ControlLabel({ label }) {
  return <div style={styles.controlLabel}>{label}</div>;
}

function SelectControl({ value, onChange, options }) {
  return (
    <div style={styles.selectShell}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={styles.select}
        aria-label="Filing status"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PercentInput({ label, value, color, onChange }) {
  return (
    <label style={styles.percentField}>
      <span style={{ ...styles.percentLabel, color }}>{label}</span>
      <span style={styles.percentInputWrap}>
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onChange(event.target.value)}
          style={styles.percentInput}
          aria-label={`${label} percentage`}
        />
        <span style={styles.percentSymbol}>%</span>
      </span>
    </label>
  );
}

function SegmentedControl({ value, onChange, options }) {
  return (
    <div style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            style={{
              ...styles.segmentButton,
              ...(active ? styles.segmentButtonActive : null),
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MetricCard({ label, value, tone }) {
  const toneMap = {
    primary: { bg: COLORS.primarySoft, color: COLORS.primary },
    ordinary: { bg: "#f1f5f9", color: COLORS.ordinary },
    capital: { bg: COLORS.capitalSoft, color: COLORS.capitalGains },
    effective: { bg: COLORS.effectiveSoft, color: COLORS.effective },
  };
  const selected = toneMap[tone] || toneMap.primary;

  return (
    <div style={styles.metricCard}>
      <div style={{ ...styles.metricIcon, background: selected.bg, color: selected.color }} />
      <div>
        <div style={styles.metricLabel}>{label}</div>
        <div style={{ ...styles.metricValue, color: selected.color }}>{value}</div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, emphasized }) {
  return (
    <div style={styles.summaryRow}>
      <span>{label}</span>
      <strong style={emphasized ? styles.summaryValueEmphasized : styles.summaryValue}>{value}</strong>
    </div>
  );
}

function BreakdownSection({ title, color, rows }) {
  return (
    <div style={styles.breakdownSection}>
      <div style={{ ...styles.breakdownTitle, color }}>{title}</div>
      <div style={styles.breakdownRows}>
        {rows.map((row, idx) => (
          <div key={`${row.label}-${idx}`} style={styles.breakdownRow}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function BracketsTable({ title, accent, note, rows }) {
  return (
    <div style={styles.bracketCard}>
      <div style={{ ...styles.bracketHeader, background: accent }}>{title}</div>
      <div style={styles.bracketNote}>{note}</div>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...styles.th, width: 82 }}>Rate</th>
            <th style={styles.th}>Taxable income range</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${title}-${i}`} style={styles.tr}>
              <td style={styles.td}>
                <span style={styles.ratePill}>
                  <span style={{ ...styles.rateSwatch, background: r.color }} />
                  {(r.rate * 100).toFixed(0)}%
                </span>
              </td>
              <td style={styles.tdMono}>
                {r.upper === Infinity
                  ? `Over ${formatMoneyFull(r.lower)}`
                  : r.lower === 0
                    ? `Up to ${formatMoneyFull(r.upper)}`
                    : `${formatMoneyFull(r.lower)} – ${formatMoneyFull(r.upper)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegendLine({ color, label, dashed }) {
  return (
    <div style={styles.legendItem}>
      <svg width={28} height={8} aria-hidden="true">
        <line x1={0} x2={28} y1={4} y2={4} stroke={color} strokeWidth={2.5} strokeDasharray={dashed ? "5,4" : "none"} />
      </svg>
      <span>{label}</span>
    </div>
  );
}

const styles = {
  pageShell: {
    minHeight: "100vh",
    maxWidth: 1180,
    margin: "0 auto",
    padding: "32px 24px 48px",
    background: `radial-gradient(circle at top left, #ffffff 0, ${COLORS.page} 360px)`,
    color: COLORS.text,
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  hero: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 24,
    marginBottom: 22,
  },
  eyebrow: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    fontSize: "clamp(32px, 5vw, 52px)",
    lineHeight: 1.02,
    letterSpacing: "-0.045em",
    margin: 0,
    fontWeight: 800,
  },
  subtitle: {
    color: COLORS.softText,
    maxWidth: 760,
    margin: "12px 0 0",
    fontSize: 15.5,
    lineHeight: 1.55,
  },
  headerBadge: {
    minWidth: 218,
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 18,
    padding: "16px 18px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },
  headerBadgeLabel: {
    display: "block",
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 4,
  },
  headerBadgeValue: {
    display: "block",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 22,
    letterSpacing: "-0.03em",
  },
  headerBadgeHint: {
    display: "block",
    color: COLORS.muted,
    fontSize: 12.5,
    marginTop: 4,
  },
  controlCard: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 16,
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 20,
    padding: 18,
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.07)",
    marginBottom: 18,
  },
  controlGroupWide: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  controlLabel: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  selectShell: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    background: "#f8fafc",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    padding: 4,
  },
  select: {
    width: "100%",
    appearance: "auto",
    border: "none",
    outline: "none",
    background: "transparent",
    color: COLORS.text,
    borderRadius: 10,
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  segmented: {
    display: "inline-flex",
    flexWrap: "wrap",
    gap: 4,
    background: "#f1f5f9",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    padding: 4,
  },
  segmentButton: {
    appearance: "none",
    border: "none",
    background: "transparent",
    color: COLORS.softText,
    borderRadius: 10,
    padding: "8px 11px",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 150ms ease",
  },
  segmentButtonActive: {
    background: COLORS.card,
    color: COLORS.primary,
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
  },
  sliderControl: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minWidth: 260,
    gridColumn: "1 / -1",
  },
  sliderTopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  mixReadout: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  mixDivider: { color: COLORS.muted },
  mixInputs: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  percentField: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  percentLabel: {
    fontSize: 12,
    fontWeight: 800,
  },
  percentInputWrap: {
    display: "flex",
    alignItems: "center",
    background: "#f8fafc",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    overflow: "hidden",
  },
  percentInput: {
    width: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    color: COLORS.text,
    padding: "10px 10px 10px 12px",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 15,
    fontWeight: 800,
  },
  percentSymbol: {
    color: COLORS.muted,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 13,
    fontWeight: 800,
    paddingRight: 12,
  },
  sliderRow: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "center",
    gap: 10,
  },
  sliderEndLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: 700,
  },
  range: {
    width: "100%",
    accentColor: COLORS.primary,
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 14,
    marginBottom: 18,
  },
  metricCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 16,
    padding: "15px 17px",
    boxShadow: "0 14px 30px rgba(15, 23, 42, 0.06)",
  },
  metricIcon: {
    width: 10,
    height: 42,
    borderRadius: 999,
  },
  metricLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  metricValue: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: "-0.035em",
  },
  chartCard: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderTop: `3px solid ${COLORS.primary}`,
    borderRadius: 22,
    padding: "18px 20px 20px",
    boxShadow: "0 24px 70px rgba(15, 23, 42, 0.10)",
    marginBottom: 18,
  },
  chartHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    paddingBottom: 12,
    marginBottom: 12,
    borderBottom: `1px solid ${COLORS.grid}`,
  },
  cardTitle: {
    margin: 0,
    fontSize: 19,
    letterSpacing: "-0.02em",
  },
  cardSubtitle: {
    margin: "4px 0 0",
    color: COLORS.muted,
    fontSize: 13,
  },
  chartPill: {
    background: "#0f172a",
    color: "#ffffff",
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 11,
    fontWeight: 800,
    whiteSpace: "nowrap",
    boxShadow: "0 6px 16px rgba(15,23,42,0.12)",
  },
  bracketRowsWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 10,
    padding: "10px 12px 12px",
    background: "#f8fafc",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
  },
  bracketAlignedRow: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  bracketAlignedTitle: {
    fontSize: 10.5,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    whiteSpace: "nowrap",
  },
  bracketTrack: {
    position: "relative",
    height: 28,
    maxWidth: "100%",
  },
  bracketTrackPlot: {
    position: "absolute",
    top: 14,
    height: 1,
    background: "linear-gradient(90deg, rgba(148,163,184,0.18) 0%, rgba(148,163,184,0.5) 50%, rgba(148,163,184,0.18) 100%)",
  },
  bracketAlignedChip: {
    position: "absolute",
    top: 0,
    transform: "translateX(-50%)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 38,
    borderRadius: 999,
    padding: "4px 8px",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 800,
    border: "1px solid rgba(15, 23, 42, 0.10)",
    boxShadow: "0 2px 4px rgba(15,23,42,0.05), inset 0 0 0 1px rgba(255,255,255,0.18)",
    whiteSpace: "nowrap",
  },
  chartMetaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  chartMetaChip: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 24,
    borderRadius: 999,
    padding: "3px 8px",
    background: "#f8fafc",
    border: `1px solid ${COLORS.border}`,
    color: COLORS.softText,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "-0.01em",
  },
  chartWrap: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 16,
    background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
    border: `1px solid ${COLORS.border}`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
  },
  svg: {
    display: "block",
    width: "100%",
    height: "auto",
  },
  svgSectionLabel: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 11.5,
    fontWeight: 800,
    letterSpacing: "0.08em",
    pointerEvents: "none",
  },
  bandLabel: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 11.5,
    fontWeight: 800,
    pointerEvents: "none",
  },
  axisTick: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 10,
    fill: COLORS.axis,
  },
  axisTickMajor: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 10.5,
    fontWeight: 700,
    fill: COLORS.softText,
  },
  axisTickMinor: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 9,
    fill: "#94a3b8",
  },
  axisLabel: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 11.5,
    fontWeight: 800,
    letterSpacing: "0.08em",
    fill: COLORS.axis,
  },
  cursorText: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 10.5,
    fontWeight: 800,
    fill: "#ffffff",
  },
  pinInstruction: {
    position: "absolute",
    top: 10,
    right: 12,
    color: "#ffffff",
    background: "rgba(15, 23, 42, 0.86)",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 10.5,
    fontWeight: 800,
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.16)",
  },
  legendRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px 18px",
    borderTop: `1px solid ${COLORS.border}`,
    marginTop: 12,
    paddingTop: 12,
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    color: COLORS.softText,
    fontSize: 12.5,
    fontWeight: 600,
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 18,
    marginBottom: 18,
  },
  card: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 22,
    padding: "18px 20px",
    boxShadow: "0 12px 28px rgba(15, 23, 42, 0.05)",
  },
  cardKicker: {
    color: COLORS.primary,
    fontSize: 11.5,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 12,
  },
  profileHeader: {
    borderBottom: `1px solid ${COLORS.border}`,
    paddingBottom: 14,
    marginBottom: 10,
  },
  profileIncome: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: "-0.04em",
  },
  profileSub: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 3,
  },
  summaryRows: {
    display: "flex",
    flexDirection: "column",
  },
  summaryRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "9px 0",
    borderBottom: `1px solid ${COLORS.grid}`,
    color: COLORS.softText,
    fontSize: 13.5,
  },
  summaryValue: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: COLORS.text,
  },
  summaryValueEmphasized: {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: COLORS.primary,
    fontSize: 15,
  },
  breakdownSection: {
    marginBottom: 16,
  },
  breakdownTitle: {
    fontWeight: 800,
    fontSize: 14,
    marginBottom: 8,
  },
  breakdownRows: {
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    overflow: "hidden",
  },
  breakdownRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "9px 11px",
    borderBottom: `1px solid ${COLORS.grid}`,
    color: COLORS.softText,
    fontSize: 13,
  },
  detailsBox: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 20,
    padding: "15px 18px",
    marginBottom: 14,
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.04)",
  },
  detailsSummary: {
    cursor: "pointer",
    color: COLORS.text,
    fontWeight: 800,
    fontSize: 14,
  },
  detailsContent: {
    color: COLORS.softText,
    fontSize: 13.5,
    lineHeight: 1.65,
    marginTop: 12,
    maxWidth: 920,
  },
  referenceIntro: {
    color: COLORS.softText,
    fontSize: 13.5,
    marginTop: 12,
    marginBottom: 14,
  },
  referenceGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 16,
  },
  bracketCard: {
    border: `1px solid ${COLORS.border}`,
    borderRadius: 16,
    overflow: "hidden",
    background: COLORS.card,
  },
  bracketHeader: {
    color: "#ffffff",
    padding: "10px 13px",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  bracketNote: {
    color: COLORS.muted,
    background: "#f8fafc",
    borderBottom: `1px solid ${COLORS.border}`,
    padding: "9px 13px",
    fontSize: 12.5,
  },
  glanceTableWrap: {
    marginTop: 18,
  },
  smallSectionTitle: {
    margin: "0 0 8px",
    color: COLORS.softText,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  tableShell: {
    overflowX: "auto",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 16,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    background: "#f8fafc",
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    borderBottom: `1px solid ${COLORS.border}`,
  },
  tr: {
    borderBottom: `1px solid ${COLORS.grid}`,
  },
  td: {
    padding: "9px 12px",
    color: COLORS.softText,
  },
  tdMono: {
    padding: "9px 12px",
    color: COLORS.softText,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 12.5,
  },
  ratePill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontWeight: 800,
    color: COLORS.text,
  },
  rateSwatch: {
    display: "inline-block",
    width: 12,
    height: 12,
    borderRadius: 4,
    border: "1px solid rgba(15,23,42,0.12)",
  },
  sourceNote: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 1.5,
    margin: "10px 0 0",
  },
};
