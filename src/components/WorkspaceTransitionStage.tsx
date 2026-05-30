import { Component, For, JSX, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { animate, type AnimationPlaybackControlsWithThen } from 'motion';

interface WorkspaceTransitionStageProps {
  activeWorkspace: string;
  paneIds: readonly string[];
  children: (workspaceId: string) => JSX.Element;
}

const enterEase = [0.22, 1, 0.36, 1] as const;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const WorkspaceTransitionStage: Component<WorkspaceTransitionStageProps> = (props) => {
  const [mountedPaneIds, setMountedPaneIds] = createSignal<string[]>([props.activeWorkspace]);
  const mountedPanes = createMemo(() =>
    props.paneIds.filter((id) => mountedPaneIds().includes(id)),
  );

  const paneRefs = new Map<string, HTMLDivElement>();
  let activeWorkspace = props.activeWorkspace;
  let isMounted = false;
  let transitionToken = 0;
  let completionTimer: number | undefined;
  let controls: AnimationPlaybackControlsWithThen[] = [];

  const stopAnimations = () => {
    for (const control of controls) {
      control.cancel();
    }
    controls = [];
    if (completionTimer !== undefined) {
      window.clearTimeout(completionTimer);
      completionTimer = undefined;
    }
  };

  const titleFor = (element?: HTMLElement | null) =>
    element?.querySelector<HTMLElement>('[data-workspace-title], h1, h2') ?? null;

  const setPaneInteractive = (id: string, element: HTMLDivElement, isActive: boolean, keepVisible = false) => {
    element.style.pointerEvents = isActive ? 'auto' : 'none';
    element.style.visibility = isActive || keepVisible ? 'visible' : 'hidden';
    element.style.zIndex = isActive ? '2' : '0';
    element.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    element.inert = !isActive;
  };

  const setInitialPaneState = (id: string, element: HTMLDivElement) => {
    const isActive = id === activeWorkspace;
    setPaneInteractive(id, element, isActive);
    element.style.opacity = isActive ? '1' : '0';
    element.style.transform = 'translateX(0px)';
    const title = titleFor(element);
    if (title) {
      title.style.opacity = '1';
      title.style.filter = 'blur(0px)';
      title.style.transform = 'translateX(0px)';
      title.style.willChange = 'opacity, filter, transform';
    }
  };

  const hideInactivePanes = (visibleIds: Set<string>) => {
    for (const [id, element] of paneRefs) {
      if (visibleIds.has(id)) continue;
      setPaneInteractive(id, element, false);
      element.style.opacity = '0';
      element.style.transform = 'translateX(0px)';
    }
  };

  const animateWorkspaceChange = (previousId: string, nextId: string, token: number) => {
    const previousPane = paneRefs.get(previousId);
    const nextPane = paneRefs.get(nextId);
    if (!nextPane) return;

    const reduceMotion = prefersReducedMotion();
    const previousTitle = titleFor(previousPane);
    const nextTitle = titleFor(nextPane);

    hideInactivePanes(new Set([previousId, nextId]));

    setPaneInteractive(nextId, nextPane, true);
    nextPane.style.opacity = '0';
    nextPane.style.transform = reduceMotion ? 'translateX(0px)' : 'translateX(-12px)';

    if (previousPane) {
      setPaneInteractive(previousId, previousPane, false, true);
      previousPane.style.zIndex = '1';
      previousPane.inert = true;
    }

    if (nextTitle) {
      nextTitle.style.opacity = '0';
      nextTitle.style.filter = reduceMotion ? 'blur(0px)' : 'blur(3px)';
      nextTitle.style.transform = reduceMotion ? 'translateX(0px)' : 'translateX(-6px)';
    }

    if (previousTitle) {
      previousTitle.style.opacity = '1';
      previousTitle.style.filter = 'blur(0px)';
      previousTitle.style.transform = 'translateX(0px)';
    }

    const nextControls = [
      animate(
        nextPane,
        { opacity: [0, 1], x: reduceMotion ? [0, 0] : [-12, 0] },
        { duration: reduceMotion ? 0.12 : 0.36, ease: enterEase },
      ),
    ];

    if (previousPane) {
      nextControls.push(
        animate(
          previousPane,
          { opacity: [1, 0], x: reduceMotion ? [0, 0] : [0, 8] },
          { duration: reduceMotion ? 0.1 : 0.18, ease: 'easeOut' },
        ),
      );
    }

    if (nextTitle) {
      nextControls.push(
        animate(
          nextTitle,
          {
            opacity: [0, 1],
            filter: reduceMotion ? ['blur(0px)', 'blur(0px)'] : ['blur(3px)', 'blur(0px)'],
            x: reduceMotion ? [0, 0] : [-6, 0],
          },
          { duration: reduceMotion ? 0.12 : 0.36, ease: enterEase },
        ),
      );
    }

    if (previousTitle) {
      nextControls.push(
        animate(
          previousTitle,
          {
            opacity: [1, 0],
            filter: reduceMotion ? ['blur(0px)', 'blur(0px)'] : ['blur(0px)', 'blur(2px)'],
            x: reduceMotion ? [0, 0] : [0, 4],
          },
          { duration: reduceMotion ? 0.1 : 0.18, ease: 'easeOut' },
        ),
      );
    }

    controls = nextControls;
    completionTimer = window.setTimeout(() => {
      if (token !== transitionToken) return;
      for (const [id, element] of paneRefs) {
        setInitialPaneState(id, element);
      }
      controls = [];
      completionTimer = undefined;
    }, reduceMotion ? 140 : 390);
  };

  onMount(() => {
    for (const [id, element] of paneRefs) {
      setInitialPaneState(id, element);
    }
    isMounted = true;
  });

  createEffect(() => {
    const nextWorkspace = props.activeWorkspace;
    setMountedPaneIds((ids) =>
      ids.includes(nextWorkspace) ? ids : [...ids, nextWorkspace],
    );

    if (nextWorkspace === activeWorkspace) return;

    const previousWorkspace = activeWorkspace;
    activeWorkspace = nextWorkspace;

    if (!isMounted) return;

    const token = ++transitionToken;
    stopAnimations();
    window.requestAnimationFrame(() => {
      if (token !== transitionToken) return;
      animateWorkspaceChange(previousWorkspace, nextWorkspace, token);
    });
  });

  onCleanup(() => {
    stopAnimations();
  });

  return (
    <div class="relative h-full w-full overflow-hidden bg-transparent">
      <For each={mountedPanes()}>
        {(id) => (
          <Show when={props.paneIds.includes(id)}>
            <div
              ref={(element) => {
                paneRefs.set(id, element);
                setInitialPaneState(id, element);
              }}
              class="absolute inset-0 flex h-full w-full min-w-0 bg-transparent will-change-transform"
            >
              {props.children(id)}
            </div>
          </Show>
        )}
      </For>
    </div>
  );
};
