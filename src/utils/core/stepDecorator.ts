import { test } from '@playwright/test';

/** A placeholder in a step title: `{name}` or a dotted path into a parameter, `{player.name}`. */
const PLACEHOLDER = /\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\}/g;
/** Parameter or property names whose values never go into a step title. */
const SENSITIVE = /password|token|secret|authorization|cookie|credential/i;
const MAX_LENGTH = 120;

/**
 * The parameter names of a method, from its source, in order: the text between its parentheses split at the
 * top-level commas, so a default value (`tsgTeam = 'Both Teams'`) or a nested bracket does not break it. A
 * destructured parameter has no name and gets '' - a placeholder cannot point to it.
 */
const parameterNamesOf = (method: (...args: never[]) => unknown): string[] => {
  const source = method.toString();
  const names: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | undefined;
  for (let index = source.indexOf('(') + 1; index > 0 && index < source.length; index++) {
    const char = source[index];
    if (quote) {
      current += char;
      if (char === quote && source[index - 1] !== '\\') {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if ('([{'.includes(char)) {
      depth++;
    } else if (')]}'.includes(char)) {
      if (depth === 0) {
        names.push(current);
        break;
      }
      depth--;
    } else if (char === ',' && depth === 0) {
      names.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  return names.map((parameter) => {
    const name = parameter.split('=')[0].trim().replace(/^\.\.\./, '');
    return /^[A-Za-z_$][\w$]*$/.test(name) ? name : '';
  });
};

const pad = (value: number) => String(value).padStart(2, '0');
const shorten = (text: string) => (text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text);

/** A value as a step title shows it: short, readable, and never a credential. */
const formatValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '(none)';
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return 'Invalid Date';
    }
    // The local calendar date, with the time only when there is one
    const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    return value.getHours() || value.getMinutes() ? `${date} ${pad(value.getHours())}:${pad(value.getMinutes())}` : date;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 10).map(formatValue).join(', ');
    return shorten(value.length > 10 ? `${items}, …` : items);
  }
  if (typeof value === 'object') {
    // A named thing reads by its name; anything else as short JSON without its sensitive fields
    const named = ['name', 'fullName', 'title', 'label'].map((key) => (value as Record<string, unknown>)[key]).find((name) => typeof name === 'string');
    if (named) {
      return shorten(named as string);
    }
    return shorten(JSON.stringify(value, (key, nested: unknown) => (SENSITIVE.test(key) ? '***' : nested)) ?? String(value));
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  return shorten(String(value));
};

/** The title with every placeholder - repeated ones included - replaced by its value; an unknown one is left as written. */
const renderTitle = (title: string, names: readonly string[], args: readonly unknown[]): string =>
  title.replace(PLACEHOLDER, (placeholder, path: string) => {
    const [root, ...keys] = path.split('.');
    const index = names.indexOf(root);
    if (index < 0) {
      return placeholder;
    }
    if ([root, ...keys].some((key) => SENSITIVE.test(key))) {
      return '***';
    }
    let value: unknown = args[index];
    for (const key of keys) {
      value = value === null || value === undefined ? undefined : (value as Record<string, unknown>)[key];
    }
    return formatValue(value);
  });

/**
 * Wraps an async Page Object or API helper method in a Playwright test step, reported where the method was called
 * (`box: true`); its errors pass through unchanged.
 * The title may name the method's parameters, or a property of one: `@step('Designate {official.fullName} as {role}')`.
 * Values are shortened, a Date reads as its local date, and a password, token or secret never appears.
 * @param title Optional step name; defaults to `ClassName.methodName`
 */
export function step(title?: string) {
  return function <This, Args extends unknown[], Return>(
    target: (this: This, ...args: Args) => Promise<Return>,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<Return>>,
  ) {
    // Read once per method, not on every call
    const names = parameterNamesOf(target);
    return function (this: This, ...args: Args): Promise<Return> {
      const name = title ? renderTitle(title, names, args) : `${(this as { constructor: { name: string } }).constructor.name}.${String(context.name)}`;
      return test.step(name, () => target.call(this, ...args), { box: true });
    };
  };
}
