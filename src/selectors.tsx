import React, { useEffect, useMemo, useState } from "react";
import cockpit from "cockpit";

/**
 * Lightweight reusable selectors for Pools, Users, Groups and Datasets.
 * - Uses native select for small lists
 * - Provides optional text filter for long lists
 * - Shows loading/error/empty states
 *
 * NOTE: We derive options from the current state when possible (users/groups from get-state).
 * For pools we call "smb-zfs list pools".
 * For datasets we accept a controlled list via props to keep UX sane (datasets can be huge).
 */

export interface Option {
  value: string;
  label: string;
}

interface BaseSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  allowEmpty?: boolean; // show an empty option
  className?: string;
  "aria-label"?: string;
}

interface Status {
  loading: boolean;
  error: string | null;
}

const usePools = () => {
  const [pools, setPools] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ loading: true, error: null });

  useEffect(() => {
    setStatus({ loading: true, error: null });
    cockpit
      .spawn(["smb-zfs", "list", "pools"])
      .then((output: string) => {
        try {
          const parsed = JSON.parse(output);
          setPools(Array.isArray(parsed) ? parsed : []);
        } catch {
          const lines = output
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          setPools(lines);
        }
        setStatus({ loading: false, error: null });
      })
      .catch((err: any) => {
        setPools([]);
        setStatus({ loading: false, error: err?.message || "Failed to list pools" });
      });
  }, []);

  return { pools, ...status };
};

export const LoadingOption: React.FC<{ text?: string }> = ({ text = "Loading..." }) => (
  <option value="" disabled>{text}</option>
);

export const ErrorOption: React.FC<{ text: string }> = ({ text }) => (
  <option value="" disabled>{text}</option>
);

export const EmptyOption: React.FC<{ text?: string }> = ({ text = "No options available" }) => (
  <option value="" disabled>{text}</option>
);

export const PoolSelect: React.FC<BaseSelectProps> = ({
  id,
  value,
  onChange,
  placeholder = "Select a pool",
  disabled,
  required,
  allowEmpty = true,
  className,
  "aria-label": ariaLabel,
}) => {
  const { pools, loading, error } = usePools();

  return (
    <select
      id={id}
      className={className || "pf-v5-c-form-control"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || loading || !!error}
      aria-label={ariaLabel || "ZFS pool select"}
      required={required}
    >
      {allowEmpty && <option value="">{placeholder}</option>}
      {loading && <LoadingOption />}
      {!!error && <ErrorOption text={error} />}
      {!loading && !error && pools.length === 0 && <EmptyOption />}
      {!loading &&
        !error &&
        pools.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
    </select>
  );
};

export interface StringListSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[]; // raw strings
  placeholder?: string;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  allowEmpty?: boolean | undefined; // show an empty option
  className?: string | undefined;
  "aria-label"?: string | undefined;
  enableFilterThreshold?: number | undefined; // show a client-side filter input when options exceed this
}

export const StringListSelect: React.FC<StringListSelectProps> = ({
  id,
  value,
  onChange,
  options,
  placeholder = "Select...",
  disabled,
  required,
  allowEmpty = true,
  className,
  "aria-label": ariaLabel,
  enableFilterThreshold,
}) => {
  const [filter, setFilter] = useState("");
  const threshold = enableFilterThreshold ?? 30;
  const showFilter = options.length >= threshold;
  const filtered = useMemo(
    () => (showFilter ? options.filter((o) => o.toLowerCase().includes(filter.toLowerCase())) : options),
    [options, filter, showFilter]
  );

  return (
    <div className="pf-v5-c-form-control">
      {showFilter && (
        <input
          type="text"
          className="pf-v5-c-form-control"
          style={{ marginBottom: 6 }}
          placeholder="Type to filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={`${ariaLabel || id}-filter`}
          disabled={disabled}
        />
      )}
      <select
        id={id}
        className={className || "pf-v5-c-form-control"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel || id}
        required={required}
      >
        {allowEmpty && <option value="">{placeholder}</option>}
        {filtered.length === 0 && <EmptyOption />}
        {filtered.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
};

export interface DatasetSelectProps extends BaseSelectProps {
  // Provide datasets explicitly to avoid extremely expensive full-system listing.
  // Expected format: ["pool/ds", "pool/ds/sub", ...]
  datasets: string[];
}

export const DatasetSelect: React.FC<DatasetSelectProps> = (props) => {
  return (
    <StringListSelect
      id={props.id}
      value={props.value}
      onChange={props.onChange}
      options={props.datasets}
      placeholder={props.placeholder || "Select a dataset"}
      disabled={props.disabled}
      required={props.required}
      allowEmpty={props.allowEmpty}
      className={props.className}
      aria-label={props["aria-label"] || "dataset-select"}
    />
  );
};

export const UsersSelect: React.FC<StringListSelectProps> = (props) => {
  return (
    <StringListSelect
      id={props.id}
      value={props.value}
      onChange={props.onChange}
      options={props.options}
      placeholder={props.placeholder || "Select a user"}
      disabled={props.disabled}
      required={props.required}
      allowEmpty={props.allowEmpty}
      className={props.className}
      aria-label={props["aria-label"] || "user-select"}
      enableFilterThreshold={props.enableFilterThreshold}
    />
  );
};

export const GroupsSelect: React.FC<StringListSelectProps> = (props) => {
  return (
    <StringListSelect
      id={props.id}
      value={props.value}
      onChange={props.onChange}
      options={props.options}
      placeholder={props.placeholder || "Select a group"}
      disabled={props.disabled}
      required={props.required}
      allowEmpty={props.allowEmpty}
      className={props.className}
      aria-label={props["aria-label"] || "group-select"}
      enableFilterThreshold={props.enableFilterThreshold}
    />
  );
};