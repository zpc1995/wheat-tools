import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown16Regular,
  ChevronRight16Regular,
} from '@fluentui/react-icons';

/** Any value that can appear inside parsed JSON. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type Container = JsonValue[] | { [key: string]: JsonValue };

function isContainer(value: JsonValue): value is Container {
  return typeof value === 'object' && value !== null;
}

/** Arrays render as `[ … ]`, objects as `{ … }`. */
function brackets(value: Container): [string, string] {
  return Array.isArray(value) ? ['[', ']'] : ['{', '}'];
}

/** Number of direct children of a container. */
export function sizeOf(value: Container): number {
  return Array.isArray(value) ? value.length : Object.keys(value).length;
}

/** Children as `[label, value]` pairs; array labels are indices. */
export function entriesOf(value: Container): Array<[string, JsonValue]> {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item]);
  }
  return Object.entries(value);
}

/**
 * Syntax-highlighted rendering of a primitive JSON value.
 *
 * Typed against `JsonValue` (rather than the primitive union) so call sites do
 * not depend on control-flow narrowing; containers simply are not rendered.
 */
function Primitive({ value }: { value: JsonValue }) {
  if (typeof value === 'string') {
    return <span className="wt-string">&quot;{value}&quot;</span>;
  }
  if (typeof value === 'number') {
    return <span className="wt-number">{String(value)}</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="wt-boolean">{String(value)}</span>;
  }
  if (value === null) {
    return <span className="wt-null">null</span>;
  }
  return null;
}

/** A collapsed/expanded twisty, or a spacer that keeps leaves aligned. */
function Twist({
  expanded,
  onClick,
  label,
  hidden,
}: {
  expanded: boolean;
  onClick?: () => void;
  label?: string;
  hidden?: boolean;
}) {
  if (hidden || !onClick) {
    return <span className="wt-node__toggle wt-node__toggle--leaf" aria-hidden />;
  }
  return (
    <button
      type="button"
      className="wt-node__toggle"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={label}
    >
      {expanded ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
    </button>
  );
}

interface TreeNodeProps {
  label: string | null;
  value: JsonValue;
  /** Nesting depth of this node; the root is 0. */
  depth: number;
  /** Nesting levels expanded on first render; deeper nodes start collapsed. */
  defaultExpandDepth: number;
  /** Rows rendered per container before a "load more" row appears. */
  chunkSize: number;
  /** Whether a trailing comma belongs after this node. */
  trailingComma: boolean;
}

function TreeNodeImpl({
  label,
  value,
  depth,
  defaultExpandDepth,
  chunkSize,
  trailingComma,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(() => depth < defaultExpandDepth);
  const [visibleCount, setVisibleCount] = useState(chunkSize);

  const container = isContainer(value) ? value : null;

  const shownEntries = useMemo(() => {
    if (!container) return [];
    if (!expanded) return [];
    // Collapsed nodes render nothing at all, and expanded ones render in
    // chunks so a 100k-element array cannot lock up the page.
    return entriesOf(container).slice(0, visibleCount);
  }, [container, expanded, visibleCount]);

  const totalChildren = container ? sizeOf(container) : 0;
  const hiddenCount = totalChildren - shownEntries.length;

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const keyPart: ReactNode =
    label === null ? null : (
      <>
        <span className="wt-key">&quot;{label}&quot;</span>
        <span className="wt-punct">: </span>
      </>
    );

  // ---- Primitive leaf -----------------------------------------------------
  if (!container) {
    return (
      <div className="wt-node">
        <Twist hidden expanded={false} />
        <span className="wt-node__line">
          {keyPart}
          <Primitive value={value} />
          {trailingComma && <span className="wt-punct">,</span>}
        </span>
      </div>
    );
  }

  // From here on `container` is non-null.
  const [open, close] = brackets(container);
  // ---- Empty container: `{}` / `[]` --------------------------------------
  if (totalChildren === 0) {
    return (
      <div className="wt-node">
        <Twist hidden expanded={false} />
        <span className="wt-node__line">
          {keyPart}
          <span className="wt-punct">
            {open}
            {close}
          </span>
          {trailingComma && <span className="wt-punct">,</span>}
        </span>
      </div>
    );
  }

  // ---- Collapsed container: `{ … 3 项 }` ---------------------------------
  if (!expanded) {
    return (
      <div className="wt-node">
        <Twist
          expanded={false}
          onClick={toggle}
          label={`展开 ${label ?? '根节点'}`}
        />
        <span className="wt-node__line">
          {keyPart}
          <span className="wt-punct">{open}</span>
          <span className="wt-count"> …{totalChildren} 项 </span>
          <span className="wt-punct">
            {close}
            {trailingComma ? ',' : ''}
          </span>
        </span>
      </div>
    );
  }

  // ---- Expanded container -------------------------------------------------
  return (
    <div className="wt-node-group">
      <div className="wt-node">
        <Twist
          expanded
          onClick={toggle}
          label={`收起 ${label ?? '根节点'}`}
        />
        <span className="wt-node__line">
          {keyPart}
          <span className="wt-punct">{open}</span>
        </span>
      </div>

      <div className="wt-node__children">
        {shownEntries.map(([childLabel, childValue], index) => (
          <TreeNode
            key={childLabel}
            label={childLabel}
            value={childValue}
            depth={depth + 1}
            defaultExpandDepth={defaultExpandDepth}
            chunkSize={chunkSize}
            trailingComma={index < shownEntries.length - 1 || hiddenCount > 0}
          />
        ))}

        {hiddenCount > 0 && (
          <button
            type="button"
            className="wt-node__more"
            onClick={() => setVisibleCount((count) => count + chunkSize)}
          >
            加载更多（剩余 {hiddenCount} 项）
          </button>
        )}
      </div>

      <div className="wt-node">
        <Twist hidden expanded={false} />
        <span className="wt-node__line">
          <span className="wt-punct">
            {close}
            {trailingComma ? ',' : ''}
          </span>
        </span>
      </div>
    </div>
  );
}

const TreeNode = memo(TreeNodeImpl);

export interface JsonTreeProps {
  value: JsonValue;
  /** Nesting depth expanded on first render. */
  defaultExpandDepth?: number;
  /** Rows rendered per container before a "load more" row appears. */
  chunkSize?: number;
}

/** Collapsible, syntax-highlighted JSON viewer. */
export function JsonTree({
  value,
  defaultExpandDepth = 3,
  chunkSize = 200,
}: JsonTreeProps) {
  return (
    <div className="wt-tree">
      <TreeNode
        label={null}
        value={value}
        depth={0}
        defaultExpandDepth={defaultExpandDepth}
        chunkSize={chunkSize}
        trailingComma={false}
      />
    </div>
  );
}
