const MATH_NS = 'http://www.w3.org/1998/Math/MathML';
const COMMANDS = new Map([
  ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ε'], ['theta', 'θ'], ['lambda', 'λ'], ['mu', 'μ'], ['pi', 'π'], ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'], ['phi', 'φ'], ['omega', 'ω'],
  ['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'], ['Lambda', 'Λ'], ['Pi', 'Π'], ['Sigma', 'Σ'], ['Phi', 'Φ'], ['Omega', 'Ω'],
  ['sum', '∑'], ['prod', '∏'], ['int', '∫'], ['infty', '∞'], ['partial', '∂'], ['nabla', '∇'], ['times', '×'], ['cdot', '·'], ['cdots', '⋯'], ['ldots', '…'], ['pm', '±'], ['le', '≤'], ['ge', '≥'], ['ne', '≠'], ['approx', '≈'], ['to', '→'], ['in', '∈'], ['notin', '∉'], ['ast', '∗'], ['forall', '∀'], ['exists', '∃']
]);

function node(name, text) {
  const element = document.createElementNS(MATH_NS, name);
  if (text !== undefined) element.textContent = text;
  return element;
}

class LatexParser {
  constructor(source) { this.source = source.trim(); this.index = 0; }
  peek() { return this.source[this.index] || ''; }
  take() { return this.source[this.index++] || ''; }
  skipSpace() { while (/\s/.test(this.peek())) this.index += 1; }

  parse(stop = '') {
    const row = node('mrow');
    while (this.index < this.source.length && this.peek() !== stop) {
      this.skipSpace();
      if (!this.peek() || this.peek() === stop) break;
      let atom = this.parseAtom();
      if (!atom) { this.index += 1; continue; }
      let subscript = null; let superscript = null;
      while (this.peek() === '_' || this.peek() === '^') {
        const marker = this.take();
        const value = this.parseScript();
        if (marker === '_') subscript = value; else superscript = value;
      }
      if (subscript && superscript) { const scripted = node('msubsup'); scripted.append(atom, subscript, superscript); atom = scripted; }
      else if (subscript) { const scripted = node('msub'); scripted.append(atom, subscript); atom = scripted; }
      else if (superscript) { const scripted = node('msup'); scripted.append(atom, superscript); atom = scripted; }
      row.append(atom);
    }
    if (stop && this.peek() === stop) this.index += 1;
    return row;
  }

  parseScript() { this.skipSpace(); return this.peek() === '{' ? this.parseGroup() : this.parseAtom() || node('mrow'); }
  parseGroup() { if (this.peek() === '{') this.index += 1; return this.parse('}'); }

  parseAtom() {
    const character = this.take();
    if (!character) return null;
    if (character === '{') return this.parse('}');
    if (character === '\\') return this.parseCommand();
    if (/\d/.test(character)) { let value = character; while (/\d|\./.test(this.peek())) value += this.take(); return node('mn', value); }
    if (/[A-Za-z]/.test(character)) return node('mi', character);
    if ('()[]|'.includes(character)) return node('mo', character);
    if ('+-=<>*/,'.includes(character)) return node('mo', character);
    return node('mtext', character);
  }

  parseCommand() {
    let name = '';
    while (/[A-Za-z]/.test(this.peek())) name += this.take();
    if (!name) return node('mo', this.take());
    if (name === 'left' || name === 'right') { this.skipSpace(); return node('mo', this.take()); }
    if (name === 'frac') { this.skipSpace(); const fraction = node('mfrac'); fraction.append(this.parseScript(), this.parseScript()); return fraction; }
    if (name === 'sqrt') { this.skipSpace(); const radical = node('msqrt'); radical.append(this.parseScript()); return radical; }
    if (name === 'mathbf' || name === 'mathrm' || name === 'mathit' || name === 'mathcal') { this.skipSpace(); const style = node('mstyle'); style.setAttribute('mathvariant', name === 'mathbf' ? 'bold' : name === 'mathrm' ? 'normal' : name === 'mathcal' ? 'script' : 'italic'); style.append(this.parseScript()); return style; }
    if (name === 'arg' || name === 'min' || name === 'max' || name === 'lim') return node('mo', name);
    if (name === 'text') { this.skipSpace(); const value = this.readRawGroup(); return node('mtext', value); }
    const symbol = COMMANDS.get(name);
    if (symbol) return node(['sum', 'prod', 'int', 'times', 'cdot', 'cdots', 'ldots', 'pm', 'le', 'ge', 'ne', 'approx', 'to', 'in', 'notin', 'ast', 'forall', 'exists'].includes(name) ? 'mo' : 'mi', symbol);
    return node('mtext', `\\${name}`);
  }

  readRawGroup() {
    if (this.peek() !== '{') return '';
    this.index += 1; let depth = 1; let value = '';
    while (this.index < this.source.length && depth > 0) { const character = this.take(); if (character === '{') depth += 1; else if (character === '}') depth -= 1; if (depth > 0) value += character; }
    return value;
  }
}

export function renderLatexFormula(source, { display = false } = {}) {
  const wrapper = document.createElement(display ? 'div' : 'span');
  wrapper.className = display ? 'knowledge-formula-display' : 'knowledge-formula-inline';
  wrapper.title = source.trim();
  const math = node('math');
  math.setAttribute('display', display ? 'block' : 'inline');
  math.setAttribute('aria-label', `数学公式：${source.trim()}`);
  try { math.append(new LatexParser(source).parse()); }
  catch { const fallback = node('mtext', source); math.append(fallback); wrapper.classList.add('formula-fallback'); }
  wrapper.append(math);
  return wrapper;
}
