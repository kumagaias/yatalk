import { Minus, Plus, Trash2 } from "lucide-react";

export function QuantityControl({
  label, quantity, max = 20, disabled = false, onChange,
}: {
  label: string;
  quantity: number;
  max?: number;
  disabled?: boolean;
  onChange: (quantity: number) => void;
}) {
  return (
    <div className="quantity-control" aria-label={`${label} quantity`}>
      <button type="button" aria-label={quantity === 1 ? `Remove ${label}` : `Decrease ${label}`} disabled={disabled} onClick={() => onChange(Math.max(0, quantity - 1))}>
        {quantity === 1 ? <Trash2 size={16} aria-hidden="true" /> : <Minus size={16} aria-hidden="true" />}
      </button>
      <span aria-live="polite">{quantity}</span>
      <button type="button" aria-label={`Increase ${label}`} disabled={disabled || quantity >= max} onClick={() => onChange(Math.min(max, quantity + 1))}><Plus size={16} aria-hidden="true" /></button>
    </div>
  );
}
