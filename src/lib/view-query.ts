export type QueryIssue = {
  title: string;
  priority: string;
  statusName: string;
  projectName: string | null;
  assigneeName: string | null;
  labels: { name: string }[];
};

type Token =
  | { type: 'identifier'; value: string }
  | { type: 'string'; value: string }
  | { type: 'symbol'; value: '&&' | '||' | '!' | '==' | '!=' | '(' | ')' | '.' | ',' };

type Predicate = (issue: QueryIssue) => boolean;

const COMPARABLE_FIELDS = new Set(['title', 'priority', 'status', 'project', 'assignee']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '==' || two === '!=') {
      tokens.push({ type: 'symbol', value: two });
      i += 2;
      continue;
    }

    if (c === '!' || c === '(' || c === ')' || c === '.' || c === ',') {
      tokens.push({ type: 'symbol', value: c });
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      let value = '';
      i++;
      while (i < input.length) {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1];
          i += 2;
          continue;
        }
        if (input[i] === quote) break;
        value += input[i];
        i++;
      }
      if (input[i] !== quote) throw new Error('Unterminated string literal');
      tokens.push({ type: 'string', value });
      i++;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let value = c;
      i++;
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) {
        value += input[i];
        i++;
      }
      tokens.push({ type: 'identifier', value });
      continue;
    }

    throw new Error(`Unexpected token "${c}"`);
  }

  return tokens;
}

function normalized(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function fieldValue(issue: QueryIssue, field: string) {
  switch (field) {
    case 'title': return issue.title;
    case 'priority': return issue.priority;
    case 'status': return issue.statusName;
    case 'project': return issue.projectName;
    case 'assignee': return issue.assigneeName;
    default: return '';
  }
}

class QueryParser {
  private index = 0;

  constructor(private tokens: Token[]) {}

  parse(): Predicate {
    const predicate = this.parseOr();
    if (this.peek()) throw new Error('Unexpected trailing expression');
    return predicate;
  }

  private parseOr(): Predicate {
    let left = this.parseAnd();
    while (this.match('||')) {
      const right = this.parseAnd();
      const prev = left;
      left = issue => prev(issue) || right(issue);
    }
    return left;
  }

  private parseAnd(): Predicate {
    let left = this.parseUnary();
    while (this.match('&&')) {
      const right = this.parseUnary();
      const prev = left;
      left = issue => prev(issue) && right(issue);
    }
    return left;
  }

  private parseUnary(): Predicate {
    if (this.match('!')) {
      const inner = this.parseUnary();
      return issue => !inner(issue);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Predicate {
    if (this.match('(')) {
      const inner = this.parseOr();
      this.expect(')');
      return inner;
    }

    const identifier = this.consumeIdentifier();
    if (identifier === 'labels') return this.parseLabelsIncludes();
    if (!COMPARABLE_FIELDS.has(identifier)) throw new Error(`Unsupported field "${identifier}"`);

    const operator = this.consumeComparison();
    const expected = this.consumeString();
    return issue => {
      const matches = normalized(fieldValue(issue, identifier)) === normalized(expected);
      return operator === '==' ? matches : !matches;
    };
  }

  private parseLabelsIncludes(): Predicate {
    this.expect('.');
    const method = this.consumeIdentifier();
    if (method !== 'includes') throw new Error('Only labels.includes("name") is supported');
    this.expect('(');
    const labelName = this.consumeString();
    this.expect(')');
    return issue => issue.labels.some(label => normalized(label.name) === normalized(labelName));
  }

  private peek() {
    return this.tokens[this.index];
  }

  private match(value: Token['value']) {
    const token = this.peek();
    if (token?.type === 'symbol' && token.value === value) {
      this.index++;
      return true;
    }
    return false;
  }

  private expect(value: Token['value']) {
    if (!this.match(value)) throw new Error(`Expected "${value}"`);
  }

  private consumeIdentifier() {
    const token = this.peek();
    if (token?.type !== 'identifier') throw new Error('Expected identifier');
    this.index++;
    return token.value;
  }

  private consumeString() {
    const token = this.peek();
    if (token?.type !== 'string') throw new Error('Expected string literal');
    this.index++;
    return token.value;
  }

  private consumeComparison() {
    const token = this.peek();
    if (token?.type !== 'symbol' || (token.value !== '==' && token.value !== '!=')) {
      throw new Error('Expected == or !=');
    }
    this.index++;
    return token.value;
  }
}

export function compileViewQuery(query: string): Predicate {
  const trimmed = query.trim();
  if (!trimmed) return () => true;
  return new QueryParser(tokenize(trimmed)).parse();
}
