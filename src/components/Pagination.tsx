import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  page: number;
  total: number;
  limit: number;
  onPage: (p: number) => void;
}

export function Pagination({ page, total, limit, onPage }: PaginationProps) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;

  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between pt-4 border-t border-border">
      <p className="text-xs text-muted-foreground">
        {start}–{end} de {total}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft size={14} />
        </Button>

        {Array.from({ length: pages }, (_, i) => i + 1)
          .filter(p => p === 1 || p === pages || Math.abs(p - page) <= 1)
          .reduce<(number | "…")[]>((acc, p, i, arr) => {
            if (i > 0 && typeof arr[i - 1] === "number" && (p as number) - (arr[i - 1] as number) > 1) {
              acc.push("…");
            }
            acc.push(p);
            return acc;
          }, [])
          .map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className="text-xs text-muted-foreground px-1">…</span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "default" : "outline"}
                size="icon"
                className="h-7 w-7 text-xs"
                onClick={() => onPage(p as number)}
              >
                {p}
              </Button>
            )
          )}

        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
        >
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}
