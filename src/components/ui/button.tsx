import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-3 min-h-11 px-6 text-[14px] font-semibold tracking-[0.025em] uppercase transition-[background,color,transform,opacity] duration-[120ms] ease-[cubic-bezier(0.65,0,0.35,1)] disabled:opacity-45 disabled:cursor-not-allowed active:scale-[0.97] rounded-[24px]",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-accent-2",
        ghost: "bg-transparent text-text-2 hover:text-text-1 px-3",
        outline: "bg-transparent text-text-1 ring-1 ring-inset ring-white/15",
      },
      size: {
        default: "min-h-11",
        sm: "min-h-8 rounded-full px-4",
        lg: "min-h-12 px-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
