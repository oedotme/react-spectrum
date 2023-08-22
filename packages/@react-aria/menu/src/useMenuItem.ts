/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {DOMAttributes, FocusableElement, FocusStrategy, PressEvent} from '@react-types/shared';
import {focusSafely} from '@react-aria/focus';
import {getItemCount} from '@react-stately/collections';
import {isFocusVisible, useHover, useKeyboard, usePress} from '@react-aria/interactions';
import {Key, RefObject, useCallback, useRef} from 'react';
import {menuData} from './useMenu';
import {mergeProps, useEffectEvent, useLayoutEffect, useSlotId} from '@react-aria/utils';
import {TreeState} from '@react-stately/tree';
import {useLocale} from '@react-aria/i18n';
import {useSelectableItem} from '@react-aria/selection';

export interface MenuItemAria {
  /** Props for the menu item element. */
  menuItemProps: DOMAttributes,

  /** Props for the main text element inside the menu item. */
  labelProps: DOMAttributes,

  /** Props for the description text element inside the menu item, if any. */
  descriptionProps: DOMAttributes,

  /** Props for the keyboard shortcut text element inside the item, if any. */
  keyboardShortcutProps: DOMAttributes,

  /** Whether the item is currently focused. */
  isFocused: boolean,
  /** Whether the item is currently selected. */
  isSelected: boolean,
  /** Whether the item is currently in a pressed state. */
  isPressed: boolean,
  /** Whether the item is disabled. */
  isDisabled: boolean
}

export interface AriaMenuItemProps {
  /**
   * Whether the menu item is disabled.
   * @deprecated - pass disabledKeys to useTreeState instead.
   */
  isDisabled?: boolean,

  /**
   * Whether the menu item is selected.
   * @deprecated - pass selectedKeys to useTreeState instead.
   */
  isSelected?: boolean,

  /** A screen reader only label for the menu item. */
  'aria-label'?: string,

  /** The unique key for the menu item. */
  key?: Key,

  /**
   * Handler that is called when the menu should close after selecting an item.
   * @deprecated - pass to the menu instead.
   */
  onClose?: () => void,

  /**
   * Whether the menu should close when the menu item is selected.
   * @default true
   */
  closeOnSelect?: boolean,

  /** Whether the menu item is contained in a virtual scrolling menu. */
  isVirtualized?: boolean,

  /**
   * Handler that is called when the user activates the item.
   * @deprecated - pass to the menu instead.
   */
  onAction?: (key: Key) => void,

  /** What kind of popup the item opens. */
  'aria-haspopup'?: 'menu' | 'dialog',

  // TODO: best way to pass this in? We need a way to infor the SubMenuTrigger what the focus strategy is so we can auto focus the right submenu item
  onOpen?: (val?: FocusStrategy) => void
}

/**
 * Provides the behavior and accessibility implementation for an item in a menu.
 * See `useMenu` for more details about menus.
 * @param props - Props for the item.
 * @param state - State for the menu, as returned by `useTreeState`.
 */
export function useMenuItem<T>(props: AriaMenuItemProps, state: TreeState<T>, ref: RefObject<FocusableElement>): MenuItemAria {
  let {
    key,
    closeOnSelect,
    isVirtualized,
    'aria-haspopup': hasPopup,
    onOpen
  } = props;
  let {direction} = useLocale();

  let isTrigger = !!hasPopup;
  let isOpen = state.expandedKeys.has(key);

  let isDisabled = props.isDisabled ?? state.disabledKeys.has(key);
  let isSelected = props.isSelected ?? state.selectionManager.isSelected(key);

  let openTimeout = useRef<ReturnType<typeof setTimeout> | undefined>();
  let cancelOpenTimeout = useCallback(() => {
    if (openTimeout.current) {
      clearTimeout(openTimeout.current);
      openTimeout.current = undefined;
    }
  }, [openTimeout]);

  let onSubmenuOpen = useEffectEvent((focusStrategy?: FocusStrategy) => {
    cancelOpenTimeout();
    state.setExpandedKeys(new Set([key]));
    onOpen && onOpen(focusStrategy);
  });

  useLayoutEffect(() => {
    return () => cancelOpenTimeout();
  }, [cancelOpenTimeout]);

  let data = menuData.get(state);
  let onClose = props.onClose || data.onClose;
  let onActionMenuDialogTrigger = useCallback(() => {
    if (hasPopup === 'dialog') {
      onSubmenuOpen();
    }
    // will need to disable this lint rule when using useEffectEvent https://react.dev/learn/separating-events-from-effects#logic-inside-effects-is-reactive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPopup]);
  let onAction = isTrigger ? onActionMenuDialogTrigger : props.onAction || data.onAction;

  let role = 'menuitem';
  if (state.selectionManager.selectionMode === 'single') {
    role = 'menuitemradio';
  } else if (state.selectionManager.selectionMode === 'multiple') {
    role = 'menuitemcheckbox';
  }

  let labelId = useSlotId();
  let descriptionId = useSlotId();
  let keyboardId = useSlotId();

  let ariaProps = {
    'aria-disabled': isDisabled || undefined,
    role,
    'aria-label': props['aria-label'],
    'aria-labelledby': labelId,
    'aria-describedby': [descriptionId, keyboardId].filter(Boolean).join(' ') || undefined
  };

  if (state.selectionManager.selectionMode !== 'none') {
    ariaProps['aria-checked'] = isSelected;
  }

  if (isVirtualized) {
    ariaProps['aria-posinset'] = state.collection.getItem(key).index;
    ariaProps['aria-setsize'] = getItemCount(state.collection);
  }

  if (hasPopup != null) {
    ariaProps['aria-haspopup'] = hasPopup;
    ariaProps['aria-expanded'] = isOpen ? 'true' : 'false';
  }

  // TODO: for press and keyboard interactions, perhaps move into useMenuTrigger (aka support option for isSubMenu)/useSubMenuTrigger
  // instead of having it in useMenuItem
  let onPressStart = (e: PressEvent) => {
    if (e.pointerType === 'keyboard' && onAction) {
      onAction(key);
    }

    if (e.pointerType === 'virtual' && !isDisabled) {
      // If opened with a screen reader, auto focus the first submenu item.
      onSubmenuOpen('first');
    }
  };

  let onPress = (e: PressEvent) => {
    if (e.pointerType === 'touch' && !isDisabled) {
      onSubmenuOpen();
    }
  };

  let onPressUp = (e: PressEvent) => {
    if (e.pointerType !== 'keyboard') {
      if (onAction) {
        onAction(key);
      }

      // Pressing a menu item should close by default in single selection mode but not multiple
      // selection mode, except if overridden by the closeOnSelect prop.
      if (!isTrigger && onClose && (closeOnSelect ?? state.selectionManager.selectionMode !== 'multiple')) {
        onClose();
      }
    }
  };

  let {itemProps, isFocused} = useSelectableItem({
    selectionManager: state.selectionManager,
    key,
    ref,
    shouldSelectOnPressUp: true,
    allowsDifferentPressOrigin: true
  });

  let {pressProps, isPressed} = usePress({onPressStart, onPress, onPressUp, isDisabled: isDisabled || (isTrigger && state.expandedKeys.has(key))});
  let {hoverProps} = useHover({
    isDisabled,
    onHoverStart() {
      if (!isFocusVisible() && !(isTrigger && state.expandedKeys.has(key))) {
        state.selectionManager.setFocused(true);
        state.selectionManager.setFocusedKey(key);
        // focus immediately so that a focus scope opened on hover has the correct restore node
        let isFocused = key === state.selectionManager.focusedKey;
        if (isFocused && state.selectionManager.isFocused && document.activeElement !== ref.current) {
          focusSafely(ref.current);
        }
      }
    },
    onHoverChange: isHovered => {
      if (isHovered && isTrigger && !state.expandedKeys.has(key)) {
        if (!openTimeout.current) {
          openTimeout.current = setTimeout(() => {
            onSubmenuOpen();
          }, 200);
        }
      } else if (!isHovered) {
        cancelOpenTimeout();
      }
    }
  });

  // TODO: there is an issue where focus doesn't seem to move into the newly opened submenu when opening it via keyboard
  let {keyboardProps} = useKeyboard({
    onKeyDown: (e) => {
      // Ignore repeating events, which may have started on the menu trigger before moving
      // focus to the menu item. We want to wait for a second complete key press sequence.
      if (e.repeat) {
        e.continuePropagation();
        return;
      }

      switch (e.key) {
        case ' ':
          if (!isDisabled && state.selectionManager.selectionMode === 'none' && !isTrigger && closeOnSelect !== false && onClose) {
            onClose();
          } else if (isTrigger && !isDisabled) {
            onSubmenuOpen('first');
          }
          break;
        case 'Enter':
          // The Enter key should always close on select, except if overridden.
          if (!isDisabled && closeOnSelect !== false && !isTrigger && onClose) {
            onClose();
          } else if (isTrigger && !isDisabled) {
            onSubmenuOpen('first');
          }
          break;
        case 'ArrowRight':
          if (isTrigger && direction === 'ltr') {
            onSubmenuOpen('first');
          } else if (direction === 'rtl' && data.isSubMenu) {
            data.menuTriggerState.close();
          } else {
            e.continuePropagation();
          }
          break;
        case 'ArrowLeft':
          if (isTrigger && direction === 'rtl') {
            onSubmenuOpen('first');
          } else if (direction === 'ltr' && data.isSubMenu) {
            data.menuTriggerState.close();
          } else {
            e.continuePropagation();
          }
          break;
        default:
          e.continuePropagation();
          break;
      }
    }
  });

  return {
    menuItemProps: {
      ...ariaProps,
      ...mergeProps(itemProps, pressProps, hoverProps, keyboardProps)
    },
    labelProps: {
      id: labelId
    },
    descriptionProps: {
      id: descriptionId
    },
    keyboardShortcutProps: {
      id: keyboardId
    },
    isFocused,
    isSelected,
    isPressed,
    isDisabled
  };
}
