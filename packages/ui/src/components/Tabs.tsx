import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  idBase: string;
  registerTab: (value: string, element: HTMLButtonElement | null) => void;
  moveFocus: (value: string, direction: 'next' | 'previous' | 'first' | 'last') => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) throw new Error('Tabs.* можно использовать только внутри <Tabs>');
  return context;
}

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}

export interface TabScrollGeometry {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
}

export function computeTabScrollEdges({
  scrollWidth,
  clientWidth,
  scrollLeft,
}: TabScrollGeometry): { left: boolean; right: boolean } {
  const overflow = scrollWidth > clientWidth + 1;
  return {
    left: overflow && scrollLeft > 1,
    right: overflow && scrollLeft + clientWidth < scrollWidth - 1,
  };
}

function TabsRoot({ value, onValueChange, children }: TabsProps) {
  const idBase = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const registerTab = useCallback((tabValue: string, element: HTMLButtonElement | null) => {
    if (element) tabRefs.current.set(tabValue, element);
    else tabRefs.current.delete(tabValue);
  }, []);

  const moveFocus = useCallback((
    currentValue: string,
    direction: 'next' | 'previous' | 'first' | 'last',
  ) => {
    const enabled = [...tabRefs.current.entries()].filter(([, element]) => !element.disabled);
    if (!enabled.length) return;
    const current = enabled.findIndex(([tabValue]) => tabValue === currentValue);
    let next = 0;
    if (direction === 'last') next = enabled.length - 1;
    if (direction === 'next') next = current < 0 ? 0 : (current + 1) % enabled.length;
    if (direction === 'previous') next = current < 0 ? enabled.length - 1 : (current - 1 + enabled.length) % enabled.length;
    const [nextValue, nextElement] = enabled[next];
    onValueChange(nextValue);
    nextElement.focus();
  }, [onValueChange]);

  useEffect(() => {
    const active = tabRefs.current.get(value);
    const list = active?.closest<HTMLElement>('.chip-tabs__list');
    if (!active || !list) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < list.scrollLeft) list.scrollTo({ left });
    else if (right > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: right - list.clientWidth });
    }
  }, [value]);

  return (
    <TabsContext.Provider value={{ value, onValueChange, idBase, registerTab, moveFocus }}>
      <div className="chip-tabs">{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  children: ReactNode;
  ariaLabel: string;
}

function TabList({ children, ariaLabel }: TabListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setEdges(computeTabScrollEdges({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
    }));
  }, []);

  useEffect(() => {
    updateEdges();
    const element = scrollRef.current;
    if (!element) return;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateEdges);
    observer?.observe(element);
    window.addEventListener('resize', updateEdges);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateEdges);
    };
  }, [children, updateEdges]);

  return (
    <div className="chip-tabs__list-frame">
      {edges.left && (
        <span className="chip-tabs__edge chip-tabs__edge--left" aria-hidden="true">
          <ChevronLeft />
        </span>
      )}
      <div
        ref={scrollRef}
        role="tablist"
        aria-label={ariaLabel}
        className="chip-tabs__list"
        onScroll={updateEdges}
      >
        {children}
      </div>
      {edges.right && (
        <span className="chip-tabs__edge chip-tabs__edge--right" aria-hidden="true">
          <ChevronRight />
        </span>
      )}
    </div>
  );
}

export interface TabProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
}

function Tab({ value, children, disabled = false }: TabProps) {
  const context = useTabsContext();
  const active = context.value === value;
  const setRef = useCallback((element: HTMLButtonElement | null) => {
    context.registerTab(value, element);
  }, [context, value]);
  const valueId = encodeURIComponent(value);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let direction: 'next' | 'previous' | 'first' | 'last' | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') direction = 'next';
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') direction = 'previous';
    if (event.key === 'Home') direction = 'first';
    if (event.key === 'End') direction = 'last';
    if (!direction) return;
    event.preventDefault();
    context.moveFocus(value, direction);
  };

  return (
    <button
      ref={setRef}
      type="button"
      role="tab"
      data-chip-control=""
      id={`${context.idBase}-tab-${valueId}`}
      aria-controls={`${context.idBase}-panel-${valueId}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      disabled={disabled}
      className="chip-tabs__tab"
      onClick={() => context.onValueChange(value)}
      onKeyDown={handleKeyDown}
    >
      <span className="chip-tabs__label">{children}</span>
    </button>
  );
}

export interface TabPanelProps {
  value: string;
  children: ReactNode;
}

function TabPanel({ value, children }: TabPanelProps) {
  const context = useTabsContext();
  if (context.value !== value) return null;
  const valueId = encodeURIComponent(value);
  return (
    <div
      role="tabpanel"
      id={`${context.idBase}-panel-${valueId}`}
      aria-labelledby={`${context.idBase}-tab-${valueId}`}
      className="chip-tabs__panel"
      tabIndex={0}
    >
      {children}
    </div>
  );
}

type TabsCompound = typeof TabsRoot & {
  List: typeof TabList;
  Tab: typeof Tab;
  Panel: typeof TabPanel;
};

export const Tabs = TabsRoot as TabsCompound;
Tabs.List = TabList;
Tabs.Tab = Tab;
Tabs.Panel = TabPanel;
