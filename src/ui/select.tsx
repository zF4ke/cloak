import { useCallback, useId, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import { Icon } from "./components.tsx";

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: T;
  onChange(value: T): void;
  disabled?: boolean;
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
}) {
  const id = useId(),
    [container, setContainer] = useState<HTMLElement | undefined>();
  const triggerRef = useCallback((element: HTMLButtonElement | null) => {
    if (element) setContainer(element.closest("dialog") ?? undefined);
  }, []);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <Select.Root
        value={value}
        disabled={disabled}
        onValueChange={(value) => {
          const option = options.find((option) => option.value === value);
          if (option) onChange(option.value);
        }}
      >
        <Select.Trigger
          id={id}
          aria-label={label}
          className="select-trigger"
          ref={triggerRef}
        >
          <Select.Value />
          <Select.Icon className="select-arrow">
            <Icon icon={ChevronDown} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal container={container}>
          <Select.Content
            className="select-menu"
            position="popper"
            sideOffset={6}
            collisionPadding={12}
          >
            <Select.ScrollUpButton className="select-scroll">
              <Icon icon={ChevronUp} />
            </Select.ScrollUpButton>
            <Select.Viewport className="select-viewport">
              {options.map((option) => (
                <Select.Item
                  value={option.value}
                  key={option.value}
                  className="select-option"
                >
                  {option.icon && <Icon icon={option.icon} />}
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="select-check">
                    <Icon icon={Check} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="select-scroll">
              <Icon icon={ChevronDown} />
            </Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
