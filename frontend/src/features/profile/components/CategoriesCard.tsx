import { Soup } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, CardBody, CardHeader, Checkbox, ErrorState, Skeleton, useToast } from '@/components/ui';
import { useFoodCategories } from '@/features/donations/api';
import { useSetDonorCategories } from '../api';

/** Food categories the donor usually produces (used for request matching). */
export function CategoriesCard({ selected }: { selected: string[] }) {
  const categories = useFoodCategories();
  const save = useSetDonorCategories();
  const toast = useToast();
  const [value, setValue] = useState<string[]>(selected);
  const [dirty, setDirty] = useState(false);
  return (
    <Card>
      <CardHeader title="Food you usually have" description="NGO requests in these categories are recommended to you." icon={<Soup className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-4">
        {categories.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : categories.isError ? (
          <ErrorState error={categories.error} compact onRetry={() => void categories.refetch()} />
        ) : (
          <fieldset>
            <legend className="sr-only">Food categories</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {categories.data.map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.name}
                  description={c.description ?? undefined}
                  checked={value.includes(c.id)}
                  onChange={(e) => {
                    setDirty(true);
                    setValue((v) => (e.target.checked ? [...v, c.id] : v.filter((x) => x !== c.id)));
                  }}
                />
              ))}
            </div>
          </fieldset>
        )}
        <Button
          disabled={!dirty}
          loading={save.isPending}
          onClick={() =>
            save.mutate(value, {
              onSuccess: () => {
                setDirty(false);
                toast.success('Categories saved');
              },
              onError: (e) => toast.error(e),
            })
          }
        >
          Save categories
        </Button>
      </CardBody>
    </Card>
  );
}
