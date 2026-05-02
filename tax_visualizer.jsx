import React, { useState, useMemo, useRef, useCallback } from "react";

// ============================================================================
// 2025 TAX DATA (post One Big Beautiful Bill Act)
// Sources: IRS Rev. Proc. 2024-40, OBBB Act adjustments, IRS Topic 409
// ============================================================================

const STANDARD_DEDUCTION_2025 = {
  single: 15750,
  mfj: 31500,
  hoh: 23625,
};

// Ordinary income brackets — these are TAXABLE income thresholds (after std deduction)
// Format: [upper bound of bracket, marginal rate]
const ORDINARY_BRACKETS_2025 = {
  single: [
    [11925, 0.10],
    [48475, 0.12],
    [103350, 0.22],
    [197300, 0.24],
    [250525, 0.32],
    [626350, 0.35],
    [Infinity, 0.37],
  ],
  mfj: [
    [23850, 0.10],
    [96950, 0.12],
    [206700, 0.22],
    [394600, 0.24],
    [501050, 0.32],
    [751600, 0.35],
    [Infinity, 0.37],
  ],
  hoh: [
    [17000, 0.10],
    [64850, 0.12],
    [103350, 0.22],
    [197300, 0.24],
    [250500, 0.32],
    [626350, 0.35],
    [Infinity, 0.37],
  ],
};

// Long-term capital gains brackets — based on TOTAL taxable income
// Format: [upper bound of taxable income, rate]
const CAPGAINS_BRACKETS_2025 = {
  single: [
    [48350, 0.0],
    [533400, 0.15],
    [Infinity, 0.20],
  ],
  mfj: [
    [96700, 0.0],
    [600050, 0.15],
    [Infinity, 0.20],
  ],
  hoh: [
    [64750, 0.0],
    [566700, 0.15],
    [Infinity, 0.20],
  ],
};

const FILING_LABEL = {
  single: "Single",
  mfj: "Married Filing Jointly",
  hoh: "Head of Household",
};

// ============================================================================
// TAX CALCULATIONS
// ============================================================================

// Compute regular income tax on a taxable amount given a bracket schedule.
// Returns { totalTax, perBracket: [{rate, taxedAmount, taxOnBracket}] }
function calcOrdinaryTax(taxableIncome, brackets) {
  if (taxableIncome <= 0) {
    return { totalTax: 0, perBracket: brackets.map(([, rate]) => ({ rate, taxedAmount: 0, taxOnBracket: 0 })) };
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
      // fill remaining with zeros
      for (let i = perBracket.length; i < brackets.length; i++) {
        const [u, r] = brackets[i];
        perBracket.push({ rate: r, taxedAmount: 0, taxOnBracket: 0, lower: prev, upper: u });
        prev = u;
      }
      break;
    }
  }
  return { totalTax, perBracket };
}

// Compute LTCG tax. Capital gains "stack on top" of ordinary taxable income.
// The LTCG bracket your gains fall into depends on TOTAL taxable income (ordinary + gains).
function calcCapGainsTax(ordinaryTaxable, gains, cgBrackets) {
  if (gains <= 0) return { totalTax: 0, perBracket: cgBrackets.map(([, rate]) => ({ rate, taxedAmount: 0, taxOnBracket: 0 })) };
  let totalTax = 0;
  const perBracket = [];
  let remaining = gains;
  let cursor = ordinaryTaxable; // gains start stacking from here
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

// Full tax calc for a given gross income, regular% mix, filing status.
function computeTax(gross, regularPct, filing) {
  const stdDed = STANDARD_DEDUCTION_2025[filing];
  const regularGross = gross * (regularPct / 100);
  const capGainsGross = gross * (1 - regularPct / 100);

  // Standard deduction reduces ordinary income first
  const ordinaryTaxable = Math.max(0, regularGross - stdDed);
  const deductionRemaining = Math.max(0, stdDed - regularGross);
  // If deduction exceeds regular income, remainder reduces capital gains
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

// Marginal rates at a given gross income (for aggregate chart)
function getMarginalRates(gross, regularPct, filing) {
  const ord = ORDINARY_BRACKETS_2025[filing];
  const cg = CAPGAINS_BRACKETS_2025[filing];
  const stdDed = STANDARD_DEDUCTION_2025[filing];
  const regularGross = gross * (regularPct / 100);
  const capGainsGross = gross * (1 - regularPct / 100);
  const ordinaryTaxable = Math.max(0, regularGross - stdDed);
  const totalTaxable = ordinaryTaxable + capGainsTaxable(stdDed, regularGross, capGainsGross);

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
    const cgStackPos = ordinaryTaxable + 1; // where the next $ of cap gains sits
    for (const [upper, rate] of cg) {
      if (cgStackPos <= upper) {
        cgRate = rate;
        break;
      }
    }
  }
  // Blended marginal: weighted by income mix
  const blended = (regularPct / 100) * ordRate + (1 - regularPct / 100) * cgRate;
  return { ordRate, cgRate, blended };
}

function capGainsTaxable(stdDed, regularGross, capGainsGross) {
  const deductionRemaining = Math.max(0, stdDed - regularGross);
  return Math.max(0, capGainsGross - deductionRemaining);
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

// log-axis tick generation: 10k, 20k, 30k... 100k, 200k... 1M, 2M, 3M
function generateLogTicks() {
  const ticks = [];
  for (let mag = LOG_MIN; mag <= LOG_MAX; mag++) {
    const base = Math.pow(10, mag);
    for (let m = 1; m <= 9; m++) {
      const v = base * m;
      if (v >= X_MIN && v <= X_MAX) {
        ticks.push({ value: v, major: m === 1, label: m === 1 ? formatMoney(v) : (m <= 9 ? String(m) : "") });
      }
    }
  }
  return ticks;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function TaxVisualizer() {
  const [filing, setFiling] = useState("single");
  const [view, setView] = useState("individual"); // 'individual' | 'aggregate'
  const [regularPct, setRegularPct] = useState(100);
  const [hoverIncome, setHoverIncome] = useState(150000);
  const [pinned, setPinned] = useState(false);

  // Dollar input fields — user can type these directly. We track them as strings
  // so partial / blank input doesn't fight the user's keystrokes.
  const [regDollarStr, setRegDollarStr] = useState("");
  const [cgDollarStr, setCgDollarStr] = useState("");
  const [activeInput, setActiveInput] = useState(null); // 'reg' | 'cg' | null — which field is focused

  // When canonical state changes (slider, chart hover), refresh the dollar input strings
  // unless that field is currently being edited.
  React.useEffect(() => {
    const reg = Math.round(hoverIncome * (regularPct / 100));
    const cg = Math.round(hoverIncome * (1 - regularPct / 100));
    if (activeInput !== "reg") setRegDollarStr(String(reg));
    if (activeInput !== "cg") setCgDollarStr(String(cg));
  }, [hoverIncome, regularPct, activeInput]);

  // Apply dollar inputs to canonical state — call when user finishes editing (blur or Enter).
  // Both fields are read together to determine the new gross + mix.
  const applyDollarInputs = useCallback((newReg, newCg) => {
    const reg = Math.max(0, Number(newReg) || 0);
    const cg = Math.max(0, Number(newCg) || 0);
    const total = reg + cg;
    if (total <= 0) return;
    const clamped = Math.min(Math.max(total, X_MIN), X_MAX);
    // If user entered a total above range, scale proportionally — but normally they won't.
    const scale = clamped / total;
    const newPct = total > 0 ? Math.round((reg * scale / clamped) * 100) : 100;
    setHoverIncome(clamped);
    setRegularPct(Math.min(100, Math.max(0, newPct)));
    setPinned(true);
  }, []);

  const svgRef = useRef(null);

  // Responsive sizing — track container width
  const [containerWidth, setContainerWidth] = useState(900);
  const containerRef = useRef(null);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setContainerWidth(Math.max(380, e.contentRect.width));
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const W = containerWidth;
  const H = Math.max(440, Math.min(560, W * 0.55));
  const padL = 64;
  const padR = 24;
  const padT = 24;
  const padB = 72;

  const ticks = useMemo(() => generateLogTicks(), []);

  // Calc current snapshot
  const snapshot = useMemo(
    () => computeTax(hoverIncome, regularPct, filing),
    [hoverIncome, regularPct, filing]
  );

  const marginal = useMemo(
    () => getMarginalRates(hoverIncome, regularPct, filing),
    [hoverIncome, regularPct, filing]
  );

  // Bracket colors
  const ordColors = ["#e8eef7", "#c7d4ec", "#9fb3da", "#6f8fc4", "#456fa8", "#2d5489", "#1d3c6c", "#0f2447"];
  const cgColors = ["#d1fae5", "#6ee7b7", "#10b981", "#065f46"];

  // ============================================================================
  // INDIVIDUAL BRACKETS VIEW — render stacked bracket regions
  // For each bracket boundary x, we plot the "tax up to here" curve.
  // The fill between bracket i's threshold and i+1's shows the bracket region.
  // We'll compute, at every income x, the cumulative TAX as % of x for ordinary,
  // then add capital gains stack on top.
  // ============================================================================

  // Sample x points across the log range
  const samples = useMemo(() => {
    const N = 240;
    const arr = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = Math.pow(10, LOG_MIN + t * (LOG_MAX - LOG_MIN));
      arr.push(x);
    }
    return arr;
  }, []);

  // For individual brackets view: compute, at each x, the % of income falling in each bracket.
  // We render this as stacked bands. Each band's height (in %) = (incomeInBracket / x) * 100.
  // Stacked bottom-up: ordinary brackets first, then capital gains on top.
  const individualData = useMemo(() => {
    const ordBrackets = ORDINARY_BRACKETS_2025[filing];
    const cgBrackets = CAPGAINS_BRACKETS_2025[filing];
    const stdDed = STANDARD_DEDUCTION_2025[filing];

    // For each sample, we want the share-of-income-in-each-bracket.
    // Bottom band: standard deduction (untaxed).
    // Then ordinary brackets 0..n.
    // Then cap gains brackets 0..n.
    return samples.map((x) => {
      const regGross = x * (regularPct / 100);
      const cgGross = x * (1 - regularPct / 100);
      const ordTaxable = Math.max(0, regGross - stdDed);
      const dedRemaining = Math.max(0, stdDed - regGross);
      const cgTaxable = Math.max(0, cgGross - dedRemaining);

      // Standard deduction $ used (reduces income in 0% band)
      const dedUsed = Math.min(stdDed, x);

      // Ordinary bracket allocations
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
          // fill rest with zeros
          for (let j = ordBands.length; j < ordBrackets.length; j++) {
            ordBands.push({ rate: ordBrackets[j][1], amount: 0 });
          }
          break;
        }
      }

      // Cap gains bracket allocations (stacked on top of ordinaryTaxable)
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
          for (let j = cgBands.length; j < cgBrackets.length; j++) {
            cgBands.push({ rate: cgBrackets[j][1], amount: 0 });
          }
          break;
        }
      }

      return { x, dedUsed, ordBands, cgBands };
    });
  }, [samples, filing, regularPct]);

  // Build SVG paths for each band as a stacked area
  const stackedPaths = useMemo(() => {
    // Each band -> top line and bottom line; we draw filled polygon.
    // Order from bottom: standard deduction, then ordinary brackets (low to high), then cg brackets (low to high).
    const bandsCount = 1 + ORDINARY_BRACKETS_2025[filing].length + CAPGAINS_BRACKETS_2025[filing].length;
    const yMax = 100; // percent

    // For each x, compute cumulative % of income
    const cumulatives = individualData.map((d) => {
      const x = d.x;
      const cum = [0]; // start at 0%
      let acc = 0;
      acc += (d.dedUsed / x) * 100;
      cum.push(acc);
      for (const b of d.ordBands) {
        acc += (b.amount / x) * 100;
        cum.push(acc);
      }
      for (const b of d.cgBands) {
        acc += (b.amount / x) * 100;
        cum.push(acc);
      }
      return cum;
    });

    const paths = [];
    for (let i = 0; i < bandsCount; i++) {
      // Build polygon from x_min..x_max along top line (cum[i+1]) then back along bottom (cum[i])
      let d = "";
      for (let s = 0; s < individualData.length; s++) {
        const x = individualData[s].x;
        const yTop = cumulatives[s][i + 1];
        const px = xToPx(x, W, padL, padR);
        const py = yToPx(yTop, H, padT, padB, yMax);
        d += s === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
      }
      for (let s = individualData.length - 1; s >= 0; s--) {
        const x = individualData[s].x;
        const yBot = cumulatives[s][i];
        const px = xToPx(x, W, padL, padR);
        const py = yToPx(yBot, H, padT, padB, yMax);
        d += ` L ${px} ${py}`;
      }
      d += " Z";
      paths.push(d);
    }
    return paths;
  }, [individualData, W, H, filing]);

  // ============================================================================
  // AGGREGATE VIEW — line traces
  // For each x, plot:
  //   - ordinary marginal rate (black step)
  //   - cap gains marginal rate (gray step)
  //   - blended marginal (blue dashed)
  //   - average effective rate (red curve)
  // ============================================================================

  const aggData = useMemo(() => {
    return samples.map((x) => {
      const m = getMarginalRates(x, regularPct, filing);
      const t = computeTax(x, regularPct, filing);
      return {
        x,
        ordMarg: m.ordRate * 100,
        cgMarg: m.cgRate * 100,
        blended: m.blended * 100,
        avg: t.avgRate * 100,
      };
    });
  }, [samples, regularPct, filing]);

  const aggYMax = 40;

  function buildLinePath(data, key) {
    let d = "";
    data.forEach((p, i) => {
      const px = xToPx(p.x, W, padL, padR);
      const py = yToPx(p[key], H, padT, padB, aggYMax);
      d += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
    });
    return d;
  }

  // ============================================================================
  // INTERACTION
  // ============================================================================

  const handleMove = useCallback((evt) => {
    if (pinned) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    if (px < padL || px > W - padR) return;
    const x = pxToX(px, W, padL, padR);
    setHoverIncome(x);
  }, [pinned, W]);

  const handleClick = useCallback((evt) => {
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    if (px < padL || px > W - padR) return;
    const x = pxToX(px, W, padL, padR);
    setHoverIncome(x);
    setPinned((p) => !p);
  }, [W]);

  // ============================================================================
  // RENDER
  // ============================================================================

  const cursorPx = xToPx(hoverIncome, W, padL, padR);

  return (
    <div
      ref={containerRef}
      style={{
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        background: "#ffffff",
        color: "#0f172a",
        padding: "28px 32px 36px",
        maxWidth: 1100,
        margin: "0 auto",
        borderRadius: 4,
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
      />

      <div style={{
        borderBottom: "1px solid #e5e7eb",
        paddingBottom: 20,
        marginBottom: 20,
        display: "flex",
        gap: 24,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}>
        <div style={{ flex: "1 1 480px", minWidth: 0 }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#9ca3af",
            marginBottom: 6,
          }}>
            Federal Income Tax · 2025 Tax Year
          </div>
          <h1 style={{
            fontSize: 30,
            fontWeight: 700,
            margin: 0,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            color: "#0f172a",
          }}>
            Federal Tax Rate Explorer
          </h1>
          <p style={{
            fontSize: 14,
            lineHeight: 1.55,
            color: "#4b5563",
            marginTop: 10,
            marginBottom: 0,
            maxWidth: 620,
          }}>
            Model ordinary income, long-term capital gains, marginal rates, and effective federal tax rates under the selected filing status and income mix.
          </p>
        </div>

        {/* Selected Income card */}
        <div style={{
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: "14px 18px",
          minWidth: 200,
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#6b7280",
            marginBottom: 4,
            fontWeight: 600,
          }}>
            Selected Income
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 24,
            fontWeight: 700,
            color: "#0f172a",
            letterSpacing: "-0.01em",
          }}>
            {formatMoneyFull(hoverIncome)}
          </div>
          <div style={{
            fontSize: 11.5,
            color: "#9ca3af",
            marginTop: 2,
          }}>
            {pinned ? "Pinned · click to unpin" : "Hover chart to inspect"}
          </div>
        </div>
      </div>

      {/* CONTROLS */}
      <div style={{
        marginBottom: 18,
        padding: "16px 18px",
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
      }}>
        {/* Row 1: Filing Status + View Toggle */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(200px, 1fr) minmax(220px, 1fr)",
          gap: 24,
          alignItems: "end",
        }}>
          <div>
            <label style={{
              display: "block",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#6b7280",
              fontWeight: 600,
              marginBottom: 6,
            }}>
              Filing Status
            </label>
            <select
              value={filing}
              onChange={(e) => setFiling(e.target.value)}
              style={{
                fontFamily: "inherit",
                fontSize: 14,
                padding: "8px 10px",
                border: "1px solid #d1d5db",
                background: "#ffffff",
                cursor: "pointer",
                width: "100%",
                borderRadius: 6,
                color: "#0f172a",
              }}
            >
              <option value="single">Single</option>
              <option value="mfj">Married Filing Jointly</option>
              <option value="hoh">Head of Household</option>
            </select>
          </div>

          <div>
            <label style={{
              display: "block",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#6b7280",
              fontWeight: 600,
              marginBottom: 6,
            }}>
              View
            </label>
            <div style={{
              display: "inline-flex",
              background: "#f3f4f6",
              borderRadius: 6,
              padding: 3,
              border: "1px solid #e5e7eb",
              gap: 0,
            }}>
              <SegmentBtn active={view === "individual"} onClick={() => setView("individual")}>
                Bracket Stack
              </SegmentBtn>
              <SegmentBtn active={view === "aggregate"} onClick={() => setView("aggregate")}>
                Rate Curves
              </SegmentBtn>
            </div>
          </div>
        </div>

        {/* Row 2: Income Mix */}
        <div style={{ marginTop: 18 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#6b7280",
              fontWeight: 600,
            }}>
              Income Mix
            </span>
            <span style={{ fontSize: 12.5, color: "#6b7280" }}>
              <strong style={{ color: "#2d5489" }}>{regularPct}% ordinary</strong>{" "}/{" "}
              <strong style={{ color: "#059669" }}>{100 - regularPct}% capital gains</strong>
            </span>
          </div>

          {/* Two number inputs (% based) side by side */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginBottom: 12,
          }}>
            <div>
              <label style={{ fontSize: 12, color: "#1f2937", fontWeight: 600 }}>Ordinary income</label>
              <PctNumberInput
                value={regularPct}
                onChange={(v) => setRegularPct(Math.max(0, Math.min(100, v)))}
                accent="#2d5489"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>Capital gains</label>
              <PctNumberInput
                value={100 - regularPct}
                onChange={(v) => setRegularPct(Math.max(0, Math.min(100, 100 - v)))}
                accent="#059669"
              />
            </div>
          </div>

          {/* Slider underneath */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11.5, color: "#2d5489", fontWeight: 600 }}>Ordinary</span>
            <input
              type="range"
              min={0}
              max={100}
              value={regularPct}
              onChange={(e) => setRegularPct(Number(e.target.value))}
              style={{ flex: 1, accentColor: "#2d5489" }}
            />
            <span style={{ fontSize: 11.5, color: "#059669", fontWeight: 600 }}>Capital gains</span>
          </div>
        </div>

        {/* Row 3: Direct dollar inputs (collapsible feel) */}
        <div style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: "1px dashed #e5e7eb",
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "center",
          fontSize: 13,
        }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            letterSpacing: "0.14em",
            color: "#9ca3af",
            textTransform: "uppercase",
            fontWeight: 600,
          }}>
            Or enter dollars
          </span>

          <DollarField
            label="Ordinary"
            color="#2d5489"
            valueStr={regDollarStr}
            onChangeStr={setRegDollarStr}
            onFocus={() => setActiveInput("reg")}
            onBlur={() => {
              setActiveInput(null);
              applyDollarInputs(regDollarStr, cgDollarStr);
            }}
            onEnter={() => applyDollarInputs(regDollarStr, cgDollarStr)}
          />

          <DollarField
            label="Capital gains"
            color="#059669"
            valueStr={cgDollarStr}
            onChangeStr={setCgDollarStr}
            onFocus={() => setActiveInput("cg")}
            onBlur={() => {
              setActiveInput(null);
              applyDollarInputs(regDollarStr, cgDollarStr);
            }}
            onEnter={() => applyDollarInputs(regDollarStr, cgDollarStr)}
          />

          <div style={{ fontSize: 12.5, color: "#4b5563" }}>
            <span style={{ color: "#6b7280" }}>Total:</span>{" "}
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: "#0f172a" }}>
              {formatMoneyFull((Number(regDollarStr) || 0) + (Number(cgDollarStr) || 0))}
            </span>
          </div>

          {pinned && (
            <button
              onClick={() => setPinned(false)}
              style={{
                fontFamily: "inherit",
                fontSize: 12,
                padding: "5px 10px",
                background: "#ffffff",
                border: "1px solid #d1d5db",
                cursor: "pointer",
                color: "#1f2937",
                borderRadius: 4,
                marginLeft: "auto",
              }}
            >
              Unpin
            </button>
          )}
        </div>
      </div>

      {/* HERO METRIC CARDS */}
      <div style={{
        display: "grid",
        gridTemplateColumns: W < 700 ? "1fr 1fr" : "repeat(4, 1fr)",
        gap: 12,
        marginBottom: 18,
      }}>
        <HeroCard
          label="Total Federal Tax"
          value={formatMoneyFull(snapshot.totalTax)}
          accent="#dc2626"
        />
        <HeroCard
          label="Effective Rate"
          value={(snapshot.avgRate * 100).toFixed(2) + "%"}
          accent="#dc2626"
        />
        <HeroCard
          label="Blended Marginal"
          value={(marginal.blended * 100).toFixed(2) + "%"}
          accent="#2d5489"
        />
        <HeroCard
          label="After-Tax Income"
          value={formatMoneyFull(snapshot.gross - snapshot.totalTax)}
          accent="#059669"
        />
      </div>


      {/* TAX RATE PROFILE CARD — wraps the legend strip and the chart */}
      <div style={{
        marginTop: 4,
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "16px 18px 8px",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
          gap: 12,
          flexWrap: "wrap",
        }}>
          <div>
            <h3 style={{
              fontSize: 17,
              fontWeight: 700,
              margin: 0,
              color: "#0f172a",
              letterSpacing: "-0.01em",
            }}>
              Tax rate profile
            </h3>
            <p style={{
              fontSize: 12.5,
              color: "#6b7280",
              margin: "2px 0 0",
            }}>
              {view === "individual"
                ? "Use the rate guide above the chart to see how each bracket lines up with the shaded regions below."
                : "How marginal and effective rates evolve as gross income scales."}
            </p>
          </div>
          <span style={{
            display: "inline-block",
            padding: "5px 11px",
            background: "#0f172a",
            color: "#ffffff",
            fontSize: 11.5,
            fontWeight: 600,
            borderRadius: 999,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.04em",
          }}>
            {view === "individual" ? "Bracket Stack" : "Rate Curves"}
          </span>
        </div>

        {/* CONTEXT CHIPS — like PDF: filing, mix, view, scale */}
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          margin: "10px 0 4px",
        }}>
          <Chip>2025 federal</Chip>
          <Chip>{FILING_LABEL[filing]}</Chip>
          <Chip>{regularPct}% ordinary / {100 - regularPct}% capital gains</Chip>
          <Chip>{view === "individual" ? "Bracket stack" : "Rate curves"}</Chip>
          <Chip>Log income scale</Chip>
        </div>

      {/* BRACKET LEGEND STRIP — pill labels above the chart, x-aligned with bands below */}
      {view === "individual" && (
        <BracketLegend
          filing={filing}
          regularPct={regularPct}
          ordColors={ordColors}
          cgColors={cgColors}
          chartWidth={W}
          padL={padL}
          padR={padR}
        />
      )}

      {/* CHART */}
      <div style={{ position: "relative" }}>
        <svg
          ref={svgRef}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: "block", width: "100%", height: "auto", cursor: pinned ? "default" : "crosshair" }}
          onMouseMove={handleMove}
          onClick={handleClick}
        >
          {/* Background */}
          <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="#fff" stroke="#e5e7eb" />

          {/* Vertical gridlines (log) */}
          {ticks.map((t, i) => {
            const px = xToPx(t.value, W, padL, padR);
            return (
              <line
                key={i}
                x1={px} x2={px}
                y1={padT} y2={H - padB}
                stroke={t.major ? "#e5e7eb" : "#f3f4f6"}
                strokeWidth={t.major ? 1 : 0.5}
              />
            );
          })}

          {view === "individual" ? (
            <>
              {/* Stacked bands */}
              {/* Band 0: standard deduction (untaxed) */}
              <path d={stackedPaths[0]} fill="#fff" stroke="none" />
              {/* Ordinary brackets */}
              {ORDINARY_BRACKETS_2025[filing].map((b, i) => (
                <path key={`ord-${i}`} d={stackedPaths[1 + i]} fill={ordColors[i]} stroke="none" />
              ))}
              {/* Cap gains brackets */}
              {CAPGAINS_BRACKETS_2025[filing].map((b, i) => (
                <path
                  key={`cg-${i}`}
                  d={stackedPaths[1 + ORDINARY_BRACKETS_2025[filing].length + i]}
                  fill={cgColors[i]}
                  stroke="none"
                  opacity={0.92}
                />
              ))}

              {/* In-chart rate labels removed — replaced by BracketLegend strip above the chart */}
            </>
          ) : (
            <>
              {/* Aggregate rate view */}
              {/* Horizontal gridlines at 5% intervals */}
              {[5, 10, 15, 20, 25, 30, 35, 40].map((y) => {
                const py = yToPx(y, H, padT, padB, aggYMax);
                return (
                  <g key={y}>
                    <line x1={padL} x2={W - padR} y1={py} y2={py} stroke="#f3f4f6" strokeDasharray="2,3" />
                    <text x={padL - 6} y={py + 3} textAnchor="end" fontSize={10} fill="#6b7280" fontFamily="'JetBrains Mono', monospace">{y}%</text>
                  </g>
                );
              })}

              {/* Standard deduction line (vertical) */}
              {(() => {
                const stdDed = STANDARD_DEDUCTION_2025[filing];
                // Where does std deduction "kick in" on x-axis depends on regularPct
                const grossAtDed = regularPct > 0 ? stdDed / (regularPct / 100) : 0;
                if (grossAtDed < X_MIN || grossAtDed > X_MAX) return null;
                const px = xToPx(grossAtDed, W, padL, padR);
                return (
                  <line x1={px} x2={px} y1={padT} y2={H - padB} stroke="#059669" strokeDasharray="3,3" strokeWidth={1.2} />
                );
              })()}

              {/* Capital gains marginal rate (gray) */}
              <path d={buildLinePath(aggData, "cgMarg")} fill="none" stroke="#9ca3af" strokeWidth={2} />
              {/* Ordinary marginal rate (black) */}
              <path d={buildLinePath(aggData, "ordMarg")} fill="none" stroke="#0f172a" strokeWidth={2} />
              {/* Blended marginal (blue dashed) */}
              <path d={buildLinePath(aggData, "blended")} fill="none" stroke="#2d5489" strokeWidth={2} strokeDasharray="6,4" />
              {/* Average effective (red) */}
              <path d={buildLinePath(aggData, "avg")} fill="none" stroke="#dc2626" strokeWidth={2.5} />
            </>
          )}

          {/* Cursor line */}
          <line x1={cursorPx} x2={cursorPx} y1={padT} y2={H - padB} stroke="#0f172a" strokeWidth={1} strokeDasharray="3,3" opacity={0.7} />

          {/* Income label at cursor */}
          <g>
            <rect
              x={cursorPx - 38} y={H - padB + 4}
              width={76} height={18}
              fill="#0f172a"
            />
            <text
              x={cursorPx} y={H - padB + 16}
              textAnchor="middle"
              fontSize={11}
              fontFamily="'JetBrains Mono', monospace"
              fontWeight={600}
              fill="#ffffff"
            >
              {formatMoneyFull(hoverIncome)}
            </text>
          </g>

          {/* X-axis tick labels */}
          {ticks.filter((t) => t.major || (t.value < X_MAX && t.label !== "")).map((t, i) => {
            const px = xToPx(t.value, W, padL, padR);
            return (
              <text
                key={i}
                x={px} y={H - padB + 38}
                textAnchor="middle"
                fontSize={t.major ? 11 : 9}
                fill={t.major ? "#1f2937" : "#9ca3af"}
                fontFamily="'JetBrains Mono', monospace"
                fontWeight={t.major ? 600 : 400}
              >
                {t.label}
              </text>
            );
          })}

          {/* Y-axis label */}
          <text
            x={-(H / 2)} y={16}
            transform={`rotate(-90)`}
            textAnchor="middle"
            fontSize={11}
            fill="#1f2937"
            fontFamily="'JetBrains Mono', monospace"
            letterSpacing="0.08em"
          >
            {view === "individual" ? "% OF INCOME AT EACH BRACKET" : "TAX RATE (%)"}
          </text>

          {/* X-axis label */}
          <text
            x={W / 2} y={H - 12}
            textAnchor="middle"
            fontSize={11}
            fill="#1f2937"
            fontFamily="'JetBrains Mono', monospace"
            letterSpacing="0.08em"
          >
            GROSS INCOME ($) — LOG SCALE
          </text>

          {/* Y-axis tick labels for individual view */}
          {view === "individual" && [0, 20, 40, 60, 80, 100].map((y) => {
            const py = yToPx(y, H, padT, padB, 100);
            return (
              <text key={y} x={padL - 6} y={py + 3} textAnchor="end" fontSize={10} fill="#6b7280" fontFamily="'JetBrains Mono', monospace">{y}%</text>
            );
          })}
        </svg>

        {/* Pin instruction */}
        <div style={{
          position: "absolute",
          top: 12,
          right: 12,
          fontSize: 11,
          fontFamily: "inherit",
          color: "#ffffff",
          background: "#0f172a",
          padding: "5px 11px",
          borderRadius: 999,
          fontWeight: 600,
        }}>
          {pinned ? "Pinned · click to unpin" : "Hover to inspect · click to pin"}
        </div>
      </div>

      {/* LEGEND for aggregate view */}
      {view === "aggregate" && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
          fontSize: 12,
          marginTop: 12,
          padding: "10px 14px",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 6,
        }}>
          <LegendDot color="#0f172a" label="Regular income marginal rate" />
          <LegendDot color="#9ca3af" label="Capital gains marginal rate" />
          <LegendDot color="#2d5489" label="Blended marginal rate" dashed />
          <LegendDot color="#dc2626" label="Average (effective) rate" />
          <LegendDot color="#059669" label="Standard deduction threshold" dashed />
        </div>
      )}

      </div> {/* end Tax rate profile card */}

      {/* SNAPSHOT PANEL — Selected Income Profile + Bracket Breakdown */}
      <div style={{
        marginTop: 20,
        display: "grid",
        gridTemplateColumns: W < 700 ? "1fr" : "1fr 1.2fr",
        gap: 18,
      }}>
        <div style={{
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: "16px 18px",
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#6b7280",
            fontWeight: 600,
            marginBottom: 8,
          }}>
            Selected Income Profile
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 26,
            fontWeight: 700,
            color: "#0f172a",
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
          }}>
            {formatMoneyFull(hoverIncome)}
          </div>
          <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 2, marginBottom: 14 }}>
            {FILING_LABEL[filing]} · <span style={{ color: "#2d5489" }}>{regularPct}% ordinary</span> / <span style={{ color: "#059669" }}>{100 - regularPct}% capital gains</span>
          </div>
          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10, fontSize: 13, lineHeight: 2 }}>
            <SnapRow label="Regular marginal rate" value={(marginal.ordRate * 100).toFixed(0) + "%"} />
            <SnapRow label="Capital gains marginal rate" value={(marginal.cgRate * 100).toFixed(0) + "%"} />
            <SnapRow label="Blended marginal rate" value={(marginal.blended * 100).toFixed(2) + "%"} bold />
            <SnapRow label="Standard deduction" value={formatMoneyFull(snapshot.stdDed)} />
          </div>
        </div>

        <div style={{
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: "16px 18px",
          fontSize: 12.5,
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#6b7280",
            fontWeight: 600,
            marginBottom: 10,
          }}>
            Bracket Breakdown
          </div>
          {snapshot.regularGross > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: "#2d5489", marginBottom: 6, fontSize: 13.5 }}>
                Ordinary income · {formatMoneyFull(snapshot.regularGross)}
              </div>
              <div style={{ color: "#4b5563" }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "5px 0",
                  borderBottom: "1px solid #f3f4f6",
                }}>
                  <span>Standard deduction used</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#6b7280" }}>
                    {formatMoneyFull(Math.min(snapshot.stdDed, snapshot.regularGross))} untaxed
                  </span>
                </div>
                {snapshot.ordRes.perBracket.filter((b) => b.taxedAmount > 0).map((b, i) => (
                  <div key={i} style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "5px 0",
                    borderBottom: "1px solid #f3f4f6",
                  }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      {formatMoneyFull(b.taxedAmount)} @ {(b.rate * 100).toFixed(0)}%
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: "#0f172a" }}>
                      {formatMoneyFull(b.taxOnBracket)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {snapshot.capGainsGross > 0 && (
            <div>
              <div style={{ fontWeight: 700, color: "#059669", marginBottom: 6, fontSize: 13.5 }}>
                Long-term capital gains · {formatMoneyFull(snapshot.capGainsGross)}
              </div>
              <div style={{ color: "#4b5563" }}>
                {snapshot.cgRes.perBracket.filter((b) => b.taxedAmount > 0).map((b, i) => (
                  <div key={i} style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "5px 0",
                    borderBottom: "1px solid #f3f4f6",
                  }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      {formatMoneyFull(b.taxedAmount)} @ {(b.rate * 100).toFixed(0)}%
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: "#0f172a" }}>
                      {formatMoneyFull(b.taxOnBracket)}
                    </span>
                  </div>
                ))}
                {snapshot.cgRes.perBracket.every((b) => b.taxedAmount === 0 || b.rate === 0) && snapshot.capGainsTaxable === 0 && (
                  <div style={{ fontStyle: "italic", color: "#6b7280", padding: "5px 0" }}>
                    All capital gains absorbed by deduction or 0% bracket
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SANKEY — flow of dollars */}
      <div style={{ marginTop: 28, paddingTop: 22, borderTop: "1px solid #e5e7eb" }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#9ca3af",
          marginBottom: 4,
        }}>
          Flow Diagram
        </div>
        <h2 style={{
          fontSize: 20,
          fontWeight: 700,
          margin: "0 0 4px",
          letterSpacing: "-0.01em",
        }}>
          Where every dollar goes
        </h2>
        <p style={{ fontSize: 12.5, color: "#6b7280", margin: "0 0 14px" }}>
          Tracks a gross income of <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: "#1f2937" }}>{formatMoneyFull(hoverIncome)}</span> through deduction, brackets, tax, and what you keep. Move the cursor on the chart above (or click to pin) to update.
        </p>
        <SankeyDiagram snapshot={snapshot} filing={filing} ordColors={ordColors} cgColors={cgColors} containerWidth={W} />
      </div>

      {/* INSTRUCTIONS */}
      <details style={{ marginTop: 22, fontSize: 13, lineHeight: 1.6, color: "#1f2937" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>
          How to use this tool
        </summary>
        <ul style={{ paddingLeft: 20, margin: "8px 0" }}>
          <li><strong>Filing status</strong> — Single, Married Filing Jointly, or Head of Household. Each has different bracket thresholds and a different standard deduction.</li>
          <li><strong>Income mix slider</strong> — set what percentage of your income is regular wages (taxed at ordinary rates) vs. long-term capital gains (taxed at the lower preferential rates of 0/15/20%).</li>
          <li><strong>Hover or tap</strong> the chart to see your tax breakdown at a specific income. <strong>Click</strong> to pin an income; click again to release.</li>
          <li>The x-axis is <strong>logarithmic</strong>: each major tick is 10× the previous one. So $10k → $100k spans the same width as $100k → $1M.</li>
          <li><strong>Individual brackets view</strong> shows what fraction of your income lands in each bracket. <strong>Aggregate view</strong> shows the resulting marginal and effective rates as you scale up income.</li>
        </ul>
        <p style={{ fontStyle: "italic", color: "#6b7280", marginTop: 10 }}>
          The most striking thing to play with: drag the slider toward 0% Regular / 100% Capital Gains. Effective rates collapse — which is why high-net-worth households whose income is mostly investment gains often pay a lower percentage than salaried earners making an order of magnitude less. Uses 2025 brackets per IRS Rev. Proc. 2024-40 and OBBB Act standard-deduction adjustments. Federal only — does not include FICA, state tax, or NIIT.
        </p>
      </details>

      {/* BRACKETS REFERENCE TABLES */}
      <div style={{ marginTop: 28, paddingTop: 22, borderTop: "1px solid #e5e7eb" }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#9ca3af",
          marginBottom: 4,
        }}>
          Reference · 2025 Tax Year
        </div>
        <h2 style={{
          fontSize: 20,
          fontWeight: 700,
          margin: "0 0 4px",
          letterSpacing: "-0.01em",
        }}>
          Tax brackets — {FILING_LABEL[filing]}
        </h2>
        <p style={{ fontSize: 12.5, color: "#6b7280", margin: "0 0 16px" }}>
          Tables update with the filing status selected above. Standard deduction:{" "}
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: "#1f2937" }}>
            {formatMoneyFull(STANDARD_DEDUCTION_2025[filing])}
          </span>
          .
        </p>

        <div style={{
          display: "grid",
          gridTemplateColumns: W < 720 ? "1fr" : "1fr 1fr",
          gap: 18,
        }}>
          {/* Ordinary income brackets */}
          <BracketsTable
            title="Regular income (ordinary rates)"
            accent="#2d5489"
            note="Applied to taxable income (after standard deduction)."
            rows={ORDINARY_BRACKETS_2025[filing].map(([upper, rate], i, arr) => {
              const lower = i === 0 ? 0 : arr[i - 1][0];
              return {
                lower,
                upper,
                rate,
                color: ordColors[i],
              };
            })}
          />

          {/* Long-term capital gains brackets */}
          <BracketsTable
            title="Long-term capital gains"
            accent="#059669"
            note="Bracket determined by total taxable income. Held > 1 year."
            rows={CAPGAINS_BRACKETS_2025[filing].map(([upper, rate], i, arr) => {
              const lower = i === 0 ? 0 : arr[i - 1][0];
              return {
                lower,
                upper,
                rate,
                color: cgColors[i],
              };
            })}
          />
        </div>

        {/* Filing status comparison — standard deductions and top brackets */}
        <div style={{ marginTop: 22 }}>
          <h3 style={{
            fontSize: 14,
            fontWeight: 700,
            margin: "0 0 8px",
            color: "#1f2937",
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}>
            All filing statuses at a glance
          </h3>
          <div style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            overflow: "hidden",
          }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12.5,
            }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={thStyle}>Filing status</th>
                  <th style={thStyle}>Standard deduction</th>
                  <th style={thStyle}>Top 37% bracket starts</th>
                  <th style={thStyle}>15% LTCG starts</th>
                  <th style={thStyle}>20% LTCG starts</th>
                </tr>
              </thead>
              <tbody>
                {["single", "mfj", "hoh"].map((f, i) => (
                  <tr
                    key={f}
                    style={{
                      borderBottom: i < 2 ? "1px solid #f3f4f6" : "none",
                      background: f === filing ? "#eff6ff" : "transparent",
                      fontWeight: f === filing ? 600 : 400,
                    }}
                  >
                    <td style={tdStyle}>
                      {f === filing && <span style={{ color: "#2d5489", marginRight: 4 }}>▸</span>}
                      {FILING_LABEL[f]}
                    </td>
                    <td style={tdMono}>{formatMoneyFull(STANDARD_DEDUCTION_2025[f])}</td>
                    <td style={tdMono}>
                      {formatMoneyFull(ORDINARY_BRACKETS_2025[f][ORDINARY_BRACKETS_2025[f].length - 2][0])}
                    </td>
                    <td style={tdMono}>{formatMoneyFull(CAPGAINS_BRACKETS_2025[f][0][0])}</td>
                    <td style={tdMono}>{formatMoneyFull(CAPGAINS_BRACKETS_2025[f][1][0])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 8, fontStyle: "italic" }}>
            Source: IRS Revenue Procedure 2024-40. Standard deduction reflects the One Big Beautiful Bill Act adjustment signed July 2025. Bracket thresholds shown are taxable income (after standard deduction) for ordinary rates; LTCG bracket thresholds are based on total taxable income.
          </p>
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "10px 14px",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10.5,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#4b5563",
  fontWeight: 600,
};

const tdStyle = {
  padding: "9px 14px",
  color: "#1f2937",
};

const tdMono = {
  padding: "9px 14px",
  color: "#1f2937",
  fontFamily: "'JetBrains Mono', monospace",
};

function BracketsTable({ title, accent, note, rows }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e5e7eb",
      overflow: "hidden",
    }}>
      <div style={{
        background: accent,
        color: "#ffffff",
        padding: "9px 14px",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        fontWeight: 600,
      }}>
        {title}
      </div>
      <div style={{
        padding: "8px 14px",
        fontSize: 11.5,
        color: "#6b7280",
        fontStyle: "italic",
        borderBottom: "1px solid #f3f4f6",
      }}>
        {note}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 60 }}>Rate</th>
            <th style={thStyle}>Taxable income range</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid #f3f4f6" }}>
              <td style={{ padding: "8px 14px" }}>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 600,
                  color: "#0f172a",
                }}>
                  <span style={{
                    display: "inline-block",
                    width: 12,
                    height: 12,
                    background: r.color,
                    border: "1px solid rgba(0,0,0,0.1)",
                  }} />
                  {(r.rate * 100).toFixed(0)}%
                </span>
              </td>
              <td style={tdMono}>
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

function Chip({ children }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      background: "#f3f4f6",
      color: "#4b5563",
      fontSize: 11.5,
      fontWeight: 500,
      borderRadius: 999,
      border: "1px solid #e5e7eb",
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {children}
    </span>
  );
}

function SnapRow({ label, value, bold }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      borderBottom: "1px solid #f3f4f6",
    }}>
      <span style={{ color: "#4b5563", fontSize: 13 }}>{label}</span>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: bold ? 15 : 13,
        fontWeight: bold ? 700 : 600,
        color: "#0f172a",
      }}>
        {value}
      </span>
    </div>
  );
}

function SegmentBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "inherit",
        fontSize: 13,
        fontWeight: 600,
        padding: "6px 14px",
        background: active ? "#0f172a" : "transparent",
        color: active ? "#ffffff" : "#4b5563",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {children}
    </button>
  );
}

function PctNumberInput({ value, onChange, accent }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      background: "#ffffff",
      border: "1px solid #d1d5db",
      borderRadius: 6,
      marginTop: 4,
      paddingRight: 10,
    }}>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(e) => {
          const v = e.target.value === "" ? 0 : Number(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 15,
          fontWeight: 600,
          border: "none",
          background: "transparent",
          padding: "9px 12px",
          flex: 1,
          width: "100%",
          outline: "none",
          color: accent,
          MozAppearance: "textfield",
        }}
      />
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13,
        color: "#9ca3af",
        fontWeight: 500,
      }}>%</span>
    </div>
  );
}

function HeroCard({ label, value, accent }) {
  return (
    <div style={{
      background: "#ffffff",
      border: "1px solid #e5e7eb",
      borderRadius: 8,
      padding: "14px 16px",
      borderLeft: `3px solid ${accent}`,
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10.5,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "#6b7280",
        fontWeight: 600,
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 22,
        fontWeight: 700,
        color: accent,
        letterSpacing: "-0.01em",
        lineHeight: 1.1,
      }}>
        {value}
      </div>
    </div>
  );
}

function LegendDot({ color, label, dashed }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <svg width={22} height={4}>
        <line x1={0} x2={22} y1={2} y2={2} stroke={color} strokeWidth={2.5} strokeDasharray={dashed ? "4,3" : "none"} />
      </svg>
      <span style={{ color: "#1f2937" }}>{label}</span>
    </div>
  );
}

function BracketLegend({ filing, regularPct, ordColors, cgColors, chartWidth, padL, padR }) {
  // Compute x-position (in chart pixels) for each bracket pill,
  // matching the same log-midpoint-of-bracket math the chart uses internally.
  // This guarantees pills line up with the visual center of each band below.

  const ordBrackets = ORDINARY_BRACKETS_2025[filing];
  const cgBrackets = CAPGAINS_BRACKETS_2025[filing];
  const stdDed = STANDARD_DEDUCTION_2025[filing];
  const rp = regularPct / 100;

  function ordX(i) {
    const [upper] = ordBrackets[i];
    const lower = i === 0 ? 0 : ordBrackets[i - 1][0];
    let taxable;
    if (upper === Infinity) taxable = lower * 1.6;
    else taxable = Math.sqrt(Math.max(lower, 1) * upper);
    if (rp === 0) return null;
    const gross = (taxable + stdDed) / rp;
    if (gross < X_MIN || gross > X_MAX) return null;
    return xToPx(gross, chartWidth, padL, padR);
  }

  function cgX(i) {
    const [upper] = cgBrackets[i];
    const lower = i === 0 ? 0 : cgBrackets[i - 1][0];
    let totalTaxable;
    if (upper === Infinity) totalTaxable = lower * 1.5;
    else totalTaxable = Math.sqrt(Math.max(lower, 1) * upper);
    if (rp === 1) return null;
    const factor = 0.5 + 0.5 * rp;
    const gross = (totalTaxable + stdDed * rp) / Math.max(factor, 0.05);
    if (gross < X_MIN || gross > X_MAX) return null;
    return xToPx(gross, chartWidth, padL, padR);
  }

  // Pill height-aware y positions
  const rowH = 30;
  const stripH = rowH * 2 + 28;
  const pillRadius = 12;
  // Section labels live in their own column on the far left of the strip
  const sectionLabelX = 10;
  // Pills must start far enough right to clear the section labels
  const pillSafeLeft = 130;

  // Determine accessible text color per bracket — darker fills get white text
  const ordTextDark = (i) => i < 4; // first 4 brackets are light enough for dark text
  const cgTextDark = (i) => i < 2;

  // Pre-build pill positions
  const ordPills = ordBrackets.map((b, i) => ({
    rate: b[1],
    color: ordColors[i],
    x: ordX(i),
    textDark: ordTextDark(i),
  })).filter((p) => p.x !== null);

  const cgPills = cgBrackets.map((b, i) => ({
    rate: b[1],
    color: cgColors[i],
    x: cgX(i),
    textDark: cgTextDark(i),
  })).filter((p) => p.x !== null);

  // Resolve overlap by horizontally nudging pills if they'd touch
  function deOverlap(pills, minSpacing = 56) {
    const sorted = [...pills].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].x - sorted[i - 1].x < minSpacing) {
        sorted[i].x = sorted[i - 1].x + minSpacing;
      }
    }
    // Clamp to chart bounds, but ensure pills stay clear of the section labels
    sorted.forEach((p) => {
      p.x = Math.max(pillSafeLeft + 22, Math.min(chartWidth - padR - 14, p.x));
    });
    return sorted;
  }

  const ordPillsLaid = deOverlap(ordPills);
  const cgPillsLaid = deOverlap(cgPills);

  const sectionLabelW = 120;

  return (
    <div style={{
      marginBottom: 4,
      padding: "12px 14px 14px",
      background: "#f9fafb",
      border: "1px solid #e5e7eb",
      position: "relative",
    }}>
      <svg
        width={chartWidth}
        height={stripH}
        viewBox={`0 0 ${chartWidth} ${stripH}`}
        style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }}
      >
        {/* Capital gains row */}
        <g>
          <text
            x={sectionLabelX}
            y={rowH / 2 + 4}
            fontSize={11}
            fontWeight={700}
            fill="#059669"
            fontFamily="'JetBrains Mono', monospace"
            letterSpacing="0.1em"
          >
            CAPITAL GAINS
          </text>
          {/* Light baseline */}
          <line
            x1={pillSafeLeft - 10}
            x2={chartWidth - padR}
            y1={rowH / 2}
            y2={rowH / 2}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
          {cgPillsLaid.map((p, i) => (
            <g key={`cgpill-${i}`}>
              <rect
                x={p.x - 22}
                y={rowH / 2 - 11}
                width={44}
                height={22}
                rx={pillRadius}
                fill={p.color}
                stroke="rgba(0,0,0,0.12)"
                strokeWidth={0.75}
              />
              <text
                x={p.x}
                y={rowH / 2 + 4}
                textAnchor="middle"
                fontSize={11.5}
                fontWeight={700}
                fontFamily="'JetBrains Mono', monospace"
                fill={p.textDark ? "#064e3b" : "#ffffff"}
              >
                {Math.round(p.rate * 100)}%
              </text>
            </g>
          ))}
        </g>

        {/* Ordinary income row */}
        <g transform={`translate(0, ${rowH + 14})`}>
          <text
            x={sectionLabelX}
            y={rowH / 2 + 4}
            fontSize={11}
            fontWeight={700}
            fill="#2d5489"
            fontFamily="'JetBrains Mono', monospace"
            letterSpacing="0.1em"
          >
            ORDINARY INCOME
          </text>
          <line
            x1={pillSafeLeft - 10}
            x2={chartWidth - padR}
            y1={rowH / 2}
            y2={rowH / 2}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
          {ordPillsLaid.map((p, i) => (
            <g key={`ordpill-${i}`}>
              <rect
                x={p.x - 22}
                y={rowH / 2 - 11}
                width={44}
                height={22}
                rx={pillRadius}
                fill={p.color}
                stroke="rgba(0,0,0,0.12)"
                strokeWidth={0.75}
              />
              <text
                x={p.x}
                y={rowH / 2 + 4}
                textAnchor="middle"
                fontSize={11.5}
                fontWeight={700}
                fontFamily="'JetBrains Mono', monospace"
                fill={p.textDark ? "#0f2447" : "#ffffff"}
              >
                {Math.round(p.rate * 100)}%
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function DollarField({ label, color, valueStr, onChangeStr, onFocus, onBlur, onEnter }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12.5, color, fontWeight: 600 }}>{label}</span>
      <div style={{
        display: "flex",
        alignItems: "center",
        background: "#ffffff",
        border: "1px solid #d1d5db",
        paddingLeft: 6,
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13,
          color: "#6b7280",
        }}>$</span>
        <input
          type="text"
          inputMode="numeric"
          value={valueStr}
          onChange={(e) => {
            // Strip non-digits and leading zeros, but allow empty string while typing
            const cleaned = e.target.value.replace(/[^0-9]/g, "");
            onChangeStr(cleaned);
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.target.blur();
              onEnter && onEnter();
            }
          }}
          placeholder="0"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            fontWeight: 500,
            border: "none",
            background: "transparent",
            padding: "5px 8px 5px 2px",
            width: 90,
            outline: "none",
            color: "#0f172a",
          }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// SANKEY DIAGRAM — flow of dollars from gross income to taxes/kept
// Custom implementation — no external library. 4 columns:
//   col 0: Gross Income
//   col 1: Regular wages, Capital gains
//   col 2: Standard deduction + each bracket bucket (only non-empty ones)
//   col 3: Taxes total, Keep total
// ============================================================================

function SankeyDiagram({ snapshot, filing, ordColors, cgColors, containerWidth }) {
  const [hoverLink, setHoverLink] = React.useState(null);
  const [hoverNode, setHoverNode] = React.useState(null);

  const W = Math.min(containerWidth, 1100);
  const H = 480;
  const padY = 30; // top/bottom padding inside SVG
  const nodeW = 14;
  const nodeGap = 8; // vertical gap between sibling nodes in a column

  // 4 column x-positions (left edge of each column's node rectangle)
  // Spacing chosen so labels have room: leave generous gap between col 0/1 and col 1/2,
  // and between col 2/3 and col 3.
  const colXs = [
    36,
    Math.round(W * 0.27),
    Math.round(W * 0.58),
    W - 36 - nodeW,
  ];

  // ---------- BUILD NODES PER COLUMN ----------

  // Determine deduction split between regular and cap gains
  const stdDed = snapshot.stdDed;
  const dedFromReg = Math.min(stdDed, snapshot.regularGross);
  const dedFromCg = Math.max(0, Math.min(stdDed - dedFromReg, snapshot.capGainsGross));
  const totalDed = dedFromReg + dedFromCg;

  // The "Taxable Income" node represents the post-deduction ordinary income that flows to brackets
  const taxableOrdinary = snapshot.ordinaryTaxable;
  // Capital gains taxable (in the rare case deduction eats into cap gains, this is what's left)
  const cgTaxable = snapshot.capGainsTaxable;
  // Capital gains gross — the value of the "Capital Gains" middle column node
  const cgNodeValue = snapshot.capGainsGross;

  // ---- Column 0: Gross Income ----
  const col0Nodes = [
    {
      id: "gross",
      label: "Gross Income",
      value: snapshot.gross,
      color: "#475569",
    },
  ];

  // ---- Column 1: Capital Gains, Taxable Income, Deduction ----
  // Order top→bottom matches reference: Cap Gains, Taxable Income, Deduction
  const col1Nodes = [];
  if (cgNodeValue > 0) {
    col1Nodes.push({
      id: "capgains",
      label: "Capital Gains",
      value: cgNodeValue,
      color: "#10b981",
    });
  }
  // Taxable income node — only the ordinary-income side. (Cap gains has its own "Capital Gains" node.)
  if (taxableOrdinary > 0) {
    col1Nodes.push({
      id: "taxable",
      label: "Taxable Income",
      value: taxableOrdinary,
      color: "#456fa8",
    });
  }
  if (totalDed > 0) {
    col1Nodes.push({
      id: "deduction",
      label: "Deduction (Std)",
      value: totalDed,
      color: "#34d399",
      sublabel: "untaxed",
    });
  }

  // ---- Column 2: Bracket buckets ----
  // Order top→bottom: cap gains brackets (high rate to low), ordinary brackets (high rate to low),
  // then deduction's 0% bucket at bottom — matches reference where 0% sits at the bottom.
  // Actually re-checking the reference: it goes CG15% (top) → 22% → 12% → 10% → 0% (bottom).
  // Cap gains on top, then ordinary high→low, then 0% deduction at bottom. Yes.
  const col2Nodes = [];

  // Cap gains brackets (only those with non-zero amounts) — order high to low
  const cgBracketEntries = snapshot.cgRes.perBracket
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.taxedAmount > 0)
    .reverse();
  for (const { b, i } of cgBracketEntries) {
    col2Nodes.push({
      id: `cg-${i}`,
      label: `CG${(b.rate * 100).toFixed(0)}%`,
      value: b.taxedAmount,
      tax: b.taxOnBracket,
      keep: b.taxedAmount - b.taxOnBracket,
      color: cgColors[i],
      kind: "cgBracket",
      bracketIdx: i,
    });
  }

  // Ordinary brackets (only those with non-zero amounts) — order high to low
  const ordBracketEntries = snapshot.ordRes.perBracket
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.taxedAmount > 0)
    .reverse();
  for (const { b, i } of ordBracketEntries) {
    col2Nodes.push({
      id: `ord-${i}`,
      label: `${(b.rate * 100).toFixed(0)}%`,
      value: b.taxedAmount,
      tax: b.taxOnBracket,
      keep: b.taxedAmount - b.taxOnBracket,
      color: ordColors[i],
      kind: "ordBracket",
      bracketIdx: i,
    });
  }

  // Deduction at bottom — labeled 0%, the value is the deduction amount (untaxed)
  if (totalDed > 0) {
    col2Nodes.push({
      id: "ded-bucket",
      label: "0%",
      value: totalDed,
      tax: 0,
      keep: totalDed,
      color: "#34d399",
      kind: "deductionBucket",
    });
  }

  // ---- Column 3: Taxes, Keep ----
  const col3Nodes = [];
  if (snapshot.totalTax > 0) {
    col3Nodes.push({
      id: "taxes",
      label: "Taxes",
      value: snapshot.totalTax,
      color: "#dc2626",
    });
  }
  col3Nodes.push({
    id: "keep",
    label: "Income Kept",
    value: snapshot.gross - snapshot.totalTax,
    color: "#059669",
  });

  // ---------- LAYOUT: position nodes vertically ----------
  // Each column is laid out so total node heights sum proportionally and there's a small gap between siblings.
  // All four columns sum to the same total (= gross income), so they share the same scale.
  const totalH = H - padY * 2;

  function layoutColumn(nodes) {
    const totalVal = nodes.reduce((s, n) => s + n.value, 0);
    const totalGap = nodeGap * Math.max(0, nodes.length - 1);
    const flowH = totalH - totalGap;
    const scale = flowH / Math.max(totalVal, 1);
    let y = padY;
    return nodes.map((n) => {
      const h = Math.max(n.value * scale, 0.5); // min 0.5px so degenerate nodes don't disappear
      const node = { ...n, y, h };
      y += h + nodeGap;
      return node;
    });
  }

  const c0 = layoutColumn(col0Nodes);
  const c1 = layoutColumn(col1Nodes);
  const c2 = layoutColumn(col2Nodes);
  const c3 = layoutColumn(col3Nodes);

  const allNodes = [...c0, ...c1, ...c2, ...c3];
  const nodeById = Object.fromEntries(allNodes.map((n) => [n.id, n]));

  // Track which column each node belongs to
  const nodeColumn = new Map();
  c0.forEach((n) => nodeColumn.set(n.id, 0));
  c1.forEach((n) => nodeColumn.set(n.id, 1));
  c2.forEach((n) => nodeColumn.set(n.id, 2));
  c3.forEach((n) => nodeColumn.set(n.id, 3));

  // ---------- BUILD LINKS ----------
  // Track per-node consumed offset for source-side and target-side stripe stacking.
  const consumedSrc = {};
  const consumedTgt = {};
  function consumeSrc(id, amt) { const o = consumedSrc[id] || 0; consumedSrc[id] = o + amt; return o; }
  function consumeTgt(id, amt) { const o = consumedTgt[id] || 0; consumedTgt[id] = o + amt; return o; }

  function makeLink(srcId, tgtId, value, color, fromLabel, toLabel) {
    const src = nodeById[srcId];
    const tgt = nodeById[tgtId];
    if (!src || !tgt || value <= 0) return null;
    const srcCol = nodeColumn.get(srcId);
    const tgtCol = nodeColumn.get(tgtId);
    const srcScale = src.h / Math.max(src.value, 1e-9);
    const tgtScale = tgt.h / Math.max(tgt.value, 1e-9);
    const oSrc = consumeSrc(srcId, value);
    const oTgt = consumeTgt(tgtId, value);
    return {
      id: `${srcId}->${tgtId}`,
      x0: colXs[srcCol] + nodeW,
      y0: src.y + oSrc * srcScale,
      h0: value * srcScale,
      x1: colXs[tgtCol],
      y1: tgt.y + oTgt * tgtScale,
      h1: value * tgtScale,
      color,
      value,
      from: fromLabel,
      to: toLabel,
      srcId,
      tgtId,
    };
  }

  const links = [];

  // ---- Layer A: Gross → col1 nodes ----
  // Order matters! Match top-to-bottom of col1 to determine source-side stripe order.
  // Col1 order: capgains, taxable, deduction.
  // To keep the source-side stripes flowing cleanly, we consume gross's source slots in this order.
  if (cgNodeValue > 0) {
    links.push(makeLink("gross", "capgains", cgNodeValue, "#34d399", "Gross Income", "Capital Gains"));
  }
  if (taxableOrdinary > 0) {
    links.push(makeLink("gross", "taxable", taxableOrdinary, "#9fb3da", "Gross Income", "Taxable Income"));
  }
  if (totalDed > 0) {
    links.push(makeLink("gross", "deduction", totalDed, "#a7f3d0", "Gross Income", "Deduction"));
  }

  // ---- Layer B: col1 → col2 buckets ----
  // The cap gains node feeds into cap gains brackets in order (top of col2 = highest rate, last to fill).
  // For cap gains brackets, fill them in REVERSE order at source side (because col2 order is high→low and
  // the source should consume top-down). Iterate col2 cap gains nodes in their col2 order:
  for (const n of c2) {
    if (n.kind === "cgBracket") {
      // Some of cap gains node's value goes into this bracket's slot
      const val = n.value;
      links.push(makeLink("capgains", n.id, val, n.color, "Capital Gains", n.label));
    } else if (n.kind === "ordBracket") {
      const val = n.value;
      links.push(makeLink("taxable", n.id, val, n.color, "Taxable Income", n.label));
    } else if (n.kind === "deductionBucket") {
      // Deduction flows directly to the 0% bucket
      links.push(makeLink("deduction", n.id, n.value, n.color, "Deduction", "0% Untaxed"));
    }
  }

  // ---- Layer C: col2 → Taxes / Keep ----
  // For each bracket bucket, send tax portion to "Taxes" and keep portion to "Keep".
  // To make the right side legible we want the "Taxes" stripes ordered top→bottom matching their source brackets.
  // We process col2 in its display order so source-side consumption is sequential.
  for (const n of c2) {
    const taxAmt = n.tax || 0;
    const keepAmt = n.keep || 0;
    if (taxAmt > 0) {
      links.push(makeLink(n.id, "taxes", taxAmt, "#ef4444", n.label, "Taxes"));
    }
    if (keepAmt > 0) {
      links.push(makeLink(n.id, "keep", keepAmt, "#34d399", n.label, "Income Kept"));
    }
  }

  const validLinks = links.filter(Boolean);

  // ---------- LINK PATH BUILDER ----------
  function linkPath(L) {
    const xMid = (L.x0 + L.x1) / 2;
    const top    = `M ${L.x0} ${L.y0} C ${xMid} ${L.y0}, ${xMid} ${L.y1}, ${L.x1} ${L.y1}`;
    const right  = ` L ${L.x1} ${L.y1 + L.h1}`;
    const bottom = ` C ${xMid} ${L.y1 + L.h1}, ${xMid} ${L.y0 + L.h0}, ${L.x0} ${L.y0 + L.h0}`;
    return `${top}${right}${bottom} Z`;
  }

  // ---------- LABEL POSITIONING ----------
  // For each node, decide label side (left or right of the node) and primary/secondary text.
  // Col 0: label to the right
  // Col 1: label to the right
  // Col 2: small bracket label to the left of the node (since these are short like "10%", "CG15%")
  // Col 3: label to the left
  function labelSpec(n) {
    const col = nodeColumn.get(n.id);
    if (col === 0) return { side: "right", primary: n.label, secondary: formatMoneyFull(n.value) };
    if (col === 1) return { side: "right", primary: n.label, secondary: formatMoneyFull(n.value) };
    if (col === 2) return { side: "left", primary: n.label, secondary: formatMoneyFull(n.value) };
    return { side: "left", primary: n.label, secondary: formatMoneyFull(n.value) };
  }

  // Tooltip text for hover
  let tipText = null;
  if (hoverLink) {
    tipText = `${hoverLink.from} → ${hoverLink.to}: ${formatMoneyFull(hoverLink.value)}`;
  } else if (hoverNode) {
    tipText = `${hoverNode.label}: ${formatMoneyFull(hoverNode.value)}`;
  }

  // ---------- RENDER ----------
  return (
    <div style={{ position: "relative" }}>
      {/* Top summary strip — shown above the diagram, like the reference */}
      <div style={{
        padding: "12px 16px",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderBottom: "none",
        textAlign: "center",
        fontSize: 13.5,
        color: "#1f2937",
        lineHeight: 1.5,
      }}>
        Total income of <strong style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatMoneyFull(snapshot.gross)}</strong>:
        you keep <strong style={{ color: "#059669", fontFamily: "'JetBrains Mono', monospace" }}>
          {formatMoneyFull(snapshot.gross - snapshot.totalTax)} ({((1 - snapshot.avgRate) * 100).toFixed(1)}%)
        </strong>
        {" "}and owe <strong style={{ color: "#dc2626", fontFamily: "'JetBrains Mono', monospace" }}>
          {formatMoneyFull(snapshot.totalTax)} ({(snapshot.avgRate * 100).toFixed(1)}%)
        </strong> in taxes.
      </div>

      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block", width: "100%", height: "auto", background: "#fff", border: "1px solid #e5e7eb" }}
      >
        {/* Links — drawn first so nodes sit on top */}
        {validLinks.map((L) => {
          const isFaded = (hoverLink && hoverLink.id !== L.id) ||
                          (hoverNode && L.srcId !== hoverNode.id && L.tgtId !== hoverNode.id);
          return (
            <path
              key={L.id}
              d={linkPath(L)}
              fill={L.color}
              opacity={isFaded ? 0.18 : 0.55}
              style={{ transition: "opacity 0.15s", cursor: "pointer" }}
              onMouseEnter={() => setHoverLink(L)}
              onMouseLeave={() => setHoverLink(null)}
            />
          );
        })}

        {/* Nodes */}
        {allNodes.map((n) => {
          const col = nodeColumn.get(n.id);
          const x = colXs[col];
          return (
            <rect
              key={`node-${n.id}`}
              x={x}
              y={n.y}
              width={nodeW}
              height={n.h}
              fill={n.color}
              stroke="rgba(0,0,0,0.25)"
              strokeWidth={0.5}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoverNode(n)}
              onMouseLeave={() => setHoverNode(null)}
            />
          );
        })}

        {/* Node labels */}
        {allNodes.map((n) => {
          if (n.h < 8) return null; // hide labels for very thin nodes
          const col = nodeColumn.get(n.id);
          const x = colXs[col];
          const spec = labelSpec(n);
          const labelX = spec.side === "right" ? x + nodeW + 7 : x - 7;
          const anchor = spec.side === "right" ? "start" : "end";
          const cy = n.y + n.h / 2;
          // Decide whether label is one or two lines based on row height
          const twoLine = n.h >= 22;
          if (twoLine) {
            return (
              <g key={`lbl-${n.id}`} style={{ pointerEvents: "none" }}>
                <text
                  x={labelX}
                  y={cy - 2}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fontSize={12}
                  fontWeight={600}
                  fill="#0f172a"
                  fontFamily="'Inter', system-ui, sans-serif"
                >
                  {spec.primary}
                </text>
                <text
                  x={labelX}
                  y={cy + 11}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fontSize={10.5}
                  fill="#6b7280"
                  fontFamily="'JetBrains Mono', monospace"
                >
                  {spec.secondary}
                </text>
              </g>
            );
          }
          // One-line: combine primary + amount
          return (
            <text
              key={`lbl-${n.id}`}
              x={labelX}
              y={cy}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={11}
              fontWeight={600}
              fill="#0f172a"
              fontFamily="'Inter', system-ui, sans-serif"
              style={{ pointerEvents: "none" }}
            >
              {spec.primary}: <tspan fontFamily="'JetBrains Mono', monospace" fontWeight={500} fill="#6b7280">{spec.secondary}</tspan>
            </text>
          );
        })}

        {/* Hover tooltip */}
        {tipText && (
          <g style={{ pointerEvents: "none" }}>
            <rect
              x={W / 2 - 200}
              y={6}
              width={400}
              height={26}
              fill="#0f172a"
              rx={3}
            />
            <text
              x={W / 2}
              y={23}
              textAnchor="middle"
              fontSize={12}
              fill="#ffffff"
              fontFamily="'JetBrains Mono', monospace"
              fontWeight={500}
            >
              {tipText}
            </text>
          </g>
        )}
      </svg>

      {/* Hover hint strip */}
      <div style={{
        marginTop: 0,
        padding: "8px 14px",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderTop: "none",
        textAlign: "center",
        fontSize: 12,
        color: "#6b7280",
        fontStyle: "italic",
      }}>
        Hover over the flows or nodes to inspect individual brackets.
      </div>

      {/* Below: detail summary panel */}
      <div style={{
        marginTop: 12,
        padding: "12px 16px",
        background: "#fff",
        border: "1px solid #e5e7eb",
        display: "grid",
        gridTemplateColumns: containerWidth < 700 ? "1fr" : "1fr 1fr",
        gap: 14,
        fontSize: 12.5,
      }}>
        <div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            letterSpacing: "0.18em",
            color: "#9ca3af",
            marginBottom: 6,
          }}>
            FEDERAL TAX SUMMARY
          </div>
          <div style={{ lineHeight: 1.7 }}>
            <Row label="Standard deduction" value={formatMoneyFull(snapshot.stdDed)} />
            <Row label="Taxable income (ordinary)" value={formatMoneyFull(snapshot.ordinaryTaxable)} />
            <Row label="Taxable cap gains" value={formatMoneyFull(snapshot.capGainsTaxable)} />
            <Row label="Avg tax rate (gross)" value={(snapshot.avgRate * 100).toFixed(2) + "%"} valueColor="#dc2626" bold />
            <Row label="Avg tax rate (taxable)"
              value={
                (snapshot.ordinaryTaxable + snapshot.capGainsTaxable > 0
                  ? (snapshot.totalTax / (snapshot.ordinaryTaxable + snapshot.capGainsTaxable) * 100).toFixed(2)
                  : "0.00") + "%"
              } />
          </div>
        </div>
        <div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            letterSpacing: "0.18em",
            color: "#9ca3af",
            marginBottom: 6,
          }}>
            MARGINAL & EFFECTIVE
          </div>
          <div style={{ lineHeight: 1.7 }}>
            <Row label="Total tax" value={formatMoneyFull(snapshot.totalTax)} valueColor="#dc2626" bold />
            <Row label="Income kept" value={formatMoneyFull(snapshot.gross - snapshot.totalTax)} valueColor="#059669" bold />
            <Row label="Ordinary income tax" value={formatMoneyFull(snapshot.ordRes.totalTax)} />
            <Row label="Capital gains tax" value={formatMoneyFull(snapshot.cgRes.totalTax)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, valueColor, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "#4b5563" }}>{label}</span>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: bold ? 700 : 500,
        color: valueColor || "#0f172a",
      }}>{value}</span>
    </div>
  );
}
