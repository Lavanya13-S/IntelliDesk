'use client';

import { Search, Filter, Inbox, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Email } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

interface EmailListProps {
  emails: Email[];
  selectedEmail: Email | null;
  onSelect: (email: Email) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filterPriority: string;
  onFilterPriorityChange: (p: string) => void;
  filterDepartment: string;
  onFilterDepartmentChange: (d: string) => void;
  departments: (string | null)[];
  loading: boolean;
  onCompose: () => void;
  processingEmail: string | null;
}

const priorityColors: Record<string, string> = {
  low: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

export function EmailList({
  emails,
  selectedEmail,
  onSelect,
  searchQuery,
  onSearchChange,
  filterPriority,
  onFilterPriorityChange,
  filterDepartment,
  onFilterDepartmentChange,
  departments,
  loading,
  processingEmail,
}: EmailListProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="p-3 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 text-xs md:text-sm h-8"
          />
        </div>
        <div className="flex gap-2">
          <Select value={filterPriority} onValueChange={onFilterPriorityChange}>
            <SelectTrigger className="flex-1 text-[10px] md:text-xs h-7">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Priorities</SelectItem>
              <SelectItem value="low" className="text-xs">Low</SelectItem>
              <SelectItem value="medium" className="text-xs">Medium</SelectItem>
              <SelectItem value="high" className="text-xs">High</SelectItem>
              <SelectItem value="critical" className="text-xs">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterDepartment} onValueChange={onFilterDepartmentChange}>
            <SelectTrigger className="flex-1 text-[10px] md:text-xs h-7">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Dept" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Depts</SelectItem>
              {departments.map((dept) => (
                <SelectItem key={dept || 'unclassified'} value={dept || 'unclassified'} className="text-xs">
                  {dept || 'Unclassified'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="p-3 space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : emails.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-xs md:text-sm">
            <Inbox className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p>No emails found</p>
          </div>
        ) : (
          <div className="divide-y">
            {emails.map((email) => (
              <button
                key={email.id}
                onClick={() => onSelect(email)}
                className={cn(
                  'w-full text-left p-3 transition-colors hover:bg-muted/50 relative',
                  selectedEmail?.id === email.id && 'bg-primary/5 border-l-2 border-l-primary'
                )}
              >
                {processingEmail === email.id && (
                  <div className="absolute right-2 top-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs md:text-sm truncate">{email.subject}</p>
                    <p className="text-[10px] md:text-xs text-muted-foreground truncate mt-0.5">{email.sender}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap" suppressHydrationWarning>
                    {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <Badge variant="secondary" className={cn('text-[9px] md:text-[10px] px-1.5 py-0 h-4', priorityColors[email.priority])}>
                    {email.priority}
                  </Badge>
                  {email.department && (
                    <Badge variant="outline" className="text-[9px] md:text-[10px] px-1.5 py-0 h-4">
                      {email.department}
                    </Badge>
                  )}
                  {email.intent && (
                    <Badge variant="outline" className="text-[9px] md:text-[10px] px-1.5 py-0 h-4 bg-muted">
                      {email.intent}
                    </Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
