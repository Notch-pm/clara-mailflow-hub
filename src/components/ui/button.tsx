import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm hover:shadow-md active:shadow-sm",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm hover:shadow-md active:shadow-sm",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground [&:hover_svg]:text-current [&:hover_.text-primary]:text-current [&:hover_.text-muted-foreground:not([class*=bg-])]:text-current shadow-sm hover:shadow active:shadow-sm",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm hover:shadow active:shadow-sm",
        ghost: "hover:bg-accent hover:text-accent-foreground [&:hover_svg]:text-current [&:hover_.text-primary]:text-current [&:hover_.text-muted-foreground:not([class*=bg-])]:text-current",
        link: "text-primary underline-offset-4 hover:underline",
        // Barre d'outils des listes : bouton cerclé, discret au repos. Un
        // réglage en vigueur (groupement, filtres) se signale par `data-active`.
        toolbar:
          "border border-input bg-background font-semibold text-foreground hover:bg-secondary/35 data-[state=open]:bg-secondary/35 data-[active=true]:border-primary data-[active=true]:bg-primary/10 data-[active=true]:text-primary",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        pill: "h-9 gap-1.5 rounded-full px-3 text-[13px] [&_svg]:size-[15px]",
        "pill-icon": "h-9 w-9 rounded-full [&_svg]:size-[15px]",
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
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
