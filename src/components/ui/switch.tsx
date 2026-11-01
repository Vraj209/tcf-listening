"use client";
import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(({ className = "", ...props }, ref) => (
  <SwitchPrimitive.Root className={`switch ${className}`} {...props} ref={ref}>
    <SwitchPrimitive.Thumb className="switch-thumb" />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;
export { Switch };
