/**
 * LeadCard — editable form showing all 11 extracted lead fields.
 * Used by the side panel to display and allow pre-import editing.
 */

import React from 'react';
import {
  User, Building2, Phone, Mail, Package,
  Hash, DollarSign, FileText, MapPin, Calendar, Link2,
} from 'lucide-react';
import type { EditableLead } from '@/types';

interface FieldDef {
  key:         keyof EditableLead;
  label:       string;
  Icon:        React.ElementType;
  type:        'text' | 'tel' | 'email' | 'textarea' | 'url';
  placeholder: string;
}

const FIELDS: FieldDef[] = [
  { key: 'buyerName',   label: 'Buyer Name',   Icon: User,       type: 'text',     placeholder: 'e.g. Rajesh Kumar'               },
  { key: 'company',     label: 'Company',       Icon: Building2,  type: 'text',     placeholder: 'e.g. ABC Traders Pvt Ltd'        },
  { key: 'mobile',      label: 'Mobile',        Icon: Phone,      type: 'tel',      placeholder: 'e.g. 9876543210'                 },
  { key: 'email',       label: 'Email',         Icon: Mail,       type: 'email',    placeholder: 'e.g. buyer@example.com'          },
  { key: 'product',     label: 'Product',       Icon: Package,    type: 'text',     placeholder: 'e.g. Industrial Safety Gloves'   },
  { key: 'quantity',    label: 'Quantity',       Icon: Hash,       type: 'text',     placeholder: 'e.g. 500 pieces'                 },
  { key: 'budget',      label: 'Budget',        Icon: DollarSign, type: 'text',     placeholder: 'e.g. ₹50,000'                    },
  { key: 'requirement', label: 'Requirement',   Icon: FileText,   type: 'textarea', placeholder: 'Full buyer requirement details…' },
  { key: 'city',        label: 'City',          Icon: MapPin,     type: 'text',     placeholder: 'e.g. Mumbai'                     },
  { key: 'state',       label: 'State',         Icon: MapPin,     type: 'text',     placeholder: 'e.g. Maharashtra'                },
  { key: 'leadDate',    label: 'Lead Date',     Icon: Calendar,   type: 'text',     placeholder: 'e.g. 2026-07-21'                 },
  { key: 'sourceUrl',   label: 'Source URL',    Icon: Link2,      type: 'url',      placeholder: 'https://www.indiamart.com/…'    },
];

interface LeadCardProps {
  lead:      EditableLead;
  onChange:  (field: keyof EditableLead, value: string) => void;
  editable?: boolean;
}

const inputBase =
  'w-full px-3 py-2 rounded-xl bg-surface-800 border border-white/5 text-sm text-slate-200 ' +
  'placeholder-slate-600 focus:border-brand-500 focus:outline-none focus:ring-1 ' +
  'focus:ring-brand-500/20 read-only:opacity-60 read-only:cursor-default transition-colors';

export function LeadCard({ lead, onChange, editable = true }: LeadCardProps) {
  return (
    <div className="space-y-3">
      {FIELDS.map(({ key, label, Icon, type, placeholder }) => {
        const value = (lead[key] ?? '') as string;

        return (
          <div key={key}>
            <label
              htmlFor={`lead-${key}`}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5"
            >
              <Icon size={11} className="text-slate-500" />
              {label}
            </label>

            {type === 'textarea' ? (
              <textarea
                id={`lead-${key}`}
                value={value}
                onChange={(e) => onChange(key, e.target.value)}
                readOnly={!editable}
                rows={3}
                placeholder={editable ? placeholder : '—'}
                className={`${inputBase} resize-none`}
              />
            ) : (
              <input
                id={`lead-${key}`}
                type={type}
                value={value}
                onChange={(e) => onChange(key, e.target.value)}
                readOnly={!editable}
                placeholder={editable ? placeholder : '—'}
                className={inputBase}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
