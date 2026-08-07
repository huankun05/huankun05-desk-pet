import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, SettingRow, Switch, useToast, useConfirm } from '../../components';
import { cronJobManager } from '../../../services/cron/manager';
import i18n from '../../../i18n';
import type { CronJob } from '../../../services/cron/types';

interface JobTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  jobType: 'interval' | 'cron';
  defaultIntervalMs?: number;
  defaultCronExpression?: string;
}

const JOB_TEMPLATES: JobTemplate[] = [
  {
    id: 'daily-greeting-morning',
    name: 'template_morning',
    description: 'template_morning_desc',
    icon: '🌅',
    jobType: 'cron',
    defaultCronExpression: '0 8 * * *',
  },
  {
    id: 'daily-greeting-evening',
    name: 'template_evening',
    description: 'template_evening_desc',
    icon: '🌙',
    jobType: 'cron',
    defaultCronExpression: '0 23 * * *',
  },
  {
    id: 'water-reminder',
    name: 'template_water',
    description: 'template_water_desc',
    icon: '💧',
    jobType: 'interval',
    defaultIntervalMs: 60 * 60 * 1000,
  },
  {
    id: 'eye-care',
    name: 'template_eye',
    description: 'template_eye_desc',
    icon: '👁️',
    jobType: 'interval',
    defaultIntervalMs: 20 * 60 * 1000,
  },
  {
    id: 'sedentary-reminder',
    name: 'template_sedentary',
    description: 'template_sedentary_desc',
    icon: '🏃',
    jobType: 'interval',
    defaultIntervalMs: 45 * 60 * 1000,
  },
];

function formatNextRunTime(nextRunTime?: string): string {
  if (!nextRunTime) return i18n.t('settings.automation.no_time');
  try {
    const date = new Date(nextRunTime);
    return date.toLocaleString(i18n.language, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return i18n.t('settings.automation.no_time');
  }
}

function getJobTypeLabel(jobType: string): string {
  switch (jobType) {
    case 'basic':
      return i18n.t('settings.automation.job_type_once');
    case 'interval':
      return i18n.t('settings.automation.job_type_interval');
    case 'cron':
      return i18n.t('settings.automation.job_type_cron');
    default:
      return jobType;
  }
}

function formatInterval(ms?: number): string {
  if (!ms) return i18n.t('settings.automation.no_time');
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return i18n.t('settings.automation.interval_hours', { count: hours });
  }
  if (minutes > 0) {
    return i18n.t('settings.automation.interval_minutes', { count: minutes });
  }
  return i18n.t('settings.automation.interval_seconds', { count: seconds });
}

export function AutomationPage() {
  const [jobs, setJobs] = useState<CronJob[]>(() => cronJobManager.getAllJobs());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<JobTemplate | null>(null);
  const [customName, setCustomName] = useState('');
  const [customInterval, setCustomInterval] = useState('60');
  const [customIntervalUnit, setCustomIntervalUnit] = useState<'seconds' | 'minutes' | 'hours'>(
    'minutes',
  );
  const [customCron, setCustomCron] = useState('0 9 * * *');
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const loadJobs = () => {
    const allJobs = cronJobManager.getAllJobs();
    setJobs(allJobs);
  };

  const handleToggle = async (id: string) => {
    await cronJobManager.toggleJob(id);
    loadJobs();
    showToast(t('settings.automation.saved'), 'success');
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm(t('settings.automation.confirm_delete')))) return;
    await cronJobManager.deleteJob(id);
    loadJobs();
    showToast(t('settings.automation.deleted'), 'success');
  };

  const handleCreateFromTemplate = (template: JobTemplate) => {
    setSelectedTemplate(template);
    setCustomName(t(`settings.automation.${template.name}`));
    if (template.jobType === 'interval' && template.defaultIntervalMs) {
      const minutes = Math.floor(template.defaultIntervalMs / 60000);
      setCustomInterval(String(minutes));
      setCustomIntervalUnit('minutes');
    } else if (template.jobType === 'cron' && template.defaultCronExpression) {
      setCustomCron(template.defaultCronExpression);
    }
  };

  const getIntervalMs = (): number => {
    const value = Number(customInterval) || 1;
    switch (customIntervalUnit) {
      case 'seconds':
        return value * 1000;
      case 'minutes':
        return value * 60 * 1000;
      case 'hours':
        return value * 60 * 60 * 1000;
      default:
        return value * 60 * 1000;
    }
  };

  const handleCreateJob = () => {
    if (!selectedTemplate) return;

    const jobId = `${selectedTemplate.id}-${crypto.randomUUID()}`;
    const jobName = customName || t(`settings.automation.${selectedTemplate.name}`);

    // 不传 handler，使用 cronJobManager 的默认 handler
    // 默认 handler 会通过 localStorage 事件通知主窗口显示气泡
    if (selectedTemplate.jobType === 'interval') {
      cronJobManager.scheduleJob({
        id: jobId,
        name: jobName,
        intervalMs: getIntervalMs(),
        persistent: true,
      });
    } else if (selectedTemplate.jobType === 'cron') {
      cronJobManager.scheduleJob({
        id: jobId,
        name: jobName,
        cronExpression: customCron,
        persistent: true,
      });
    }

    setShowCreateModal(false);
    setSelectedTemplate(null);
    loadJobs();
    showToast(t('settings.automation.created'), 'success');
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.automation.section_title')}
        description={t('settings.automation.section_desc')}
      >
        <div className="px-4 py-3 flex justify-end">
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[var(--primary-500)] rounded-lg hover:bg-[var(--primary-600)] transition-colors"
          >
            <Icon icon="solar:add-circle-bold-duotone" className="text-lg" />
            {t('settings.automation.create_task')}
          </button>
        </div>

        <div className="divide-y divide-neutral-100">
          {jobs.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Icon
                icon="solar:clock-circle-bold-duotone"
                className="text-4xl text-neutral-300 mx-auto mb-3"
              />
              <div className="text-sm text-neutral-400">{t('settings.automation.no_tasks')}</div>
              <div className="text-xs text-neutral-300 mt-1">
                {t('settings.automation.no_tasks_desc')}
              </div>
            </div>
          ) : (
            jobs.map((job, index) => (
              <div
                key={job.id}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-50 transition-colors"
                style={{
                  animation: 'fade-in-up 250ms ease forwards',
                  animationDelay: `${index * 30}ms`,
                  opacity: 0,
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-800">{job.name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-neutral-100 text-neutral-500 rounded">
                      {getJobTypeLabel(job.jobType)}
                    </span>
                    {job.persistent && (
                      <span className="text-xs px-1.5 py-0.5 bg-[var(--primary-50)] text-[var(--primary-500)] rounded">
                        {t('settings.automation.persistent')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-400 mt-0.5 flex items-center gap-3">
                    <span>
                      {job.jobType === 'interval' && formatInterval(job.intervalMs)}
                      {job.jobType === 'cron' &&
                        t('settings.automation.running_at', { time: job.cronExpression })}
                      {job.jobType === 'basic' &&
                        t('settings.automation.running_at', { time: formatNextRunTime(job.runAt) })}
                    </span>
                    <span>
                      {t('settings.automation.next_run', {
                        time: formatNextRunTime(job.nextRunTime),
                      })}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDelete(job.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 transition-colors group"
                    aria-label={t('common.delete')}
                  >
                    <Icon
                      icon="solar:trash-bin-trash-bold-duotone"
                      className="text-lg text-neutral-400 group-hover:text-red-500 transition-colors"
                    />
                  </button>
                  <Switch checked={job.enabled} onChange={() => handleToggle(job.id)} />
                </div>
              </div>
            ))
          )}
        </div>
      </Section>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div
            className="bg-white rounded-2xl w-[480px] max-h-[80vh] overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium text-neutral-800">
                  {t('settings.automation.create_modal_title')}
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {t('settings.automation.create_modal_desc')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setSelectedTemplate(null);
                }}
                className="p-1.5 rounded-lg hover:bg-neutral-100 transition-colors"
              >
                <Icon icon="solar:close-circle-bold-duotone" className="text-xl text-neutral-400" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {!selectedTemplate ? (
                <div className="space-y-2">
                  {JOB_TEMPLATES.map((template, index) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => handleCreateFromTemplate(template)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-neutral-200 hover:border-[var(--primary-300)] hover:bg-[var(--primary-50)]/50 transition-all text-left"
                      style={{
                        animation: 'fade-in-up 250ms ease forwards',
                        animationDelay: `${index * 30}ms`,
                        opacity: 0,
                      }}
                    >
                      <div className="text-2xl shrink-0">{template.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-neutral-800">
                          {t(`settings.automation.${template.name}`)}
                        </div>
                        <div className="text-xs text-neutral-400 mt-0.5">
                          {t(`settings.automation.${template.description}`)}
                        </div>
                      </div>
                      <Icon
                        icon="solar:alt-arrow-right-line-duotone"
                        className="text-lg text-neutral-300"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-neutral-50 rounded-xl">
                    <div className="text-2xl">{selectedTemplate.icon}</div>
                    <div>
                      <div className="text-sm font-medium text-neutral-800">
                        {t(`settings.automation.${selectedTemplate.name}`)}
                      </div>
                      <div className="text-xs text-neutral-400">
                        {t(`settings.automation.${selectedTemplate.description}`)}
                      </div>
                    </div>
                  </div>

                  <SettingRow
                    title={t('settings.automation.task_name')}
                    description={t('settings.automation.task_name_desc')}
                  >
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      className="w-40 px-2 py-1 text-sm border border-neutral-200 rounded-md focus:outline-none focus:border-[var(--primary-400)]"
                    />
                  </SettingRow>

                  {selectedTemplate.jobType === 'interval' && (
                    <SettingRow
                      title={t('settings.automation.reminder_interval')}
                      description={t('settings.automation.reminder_interval_desc')}
                    >
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="1"
                          value={customInterval}
                          onChange={(e) => setCustomInterval(e.target.value)}
                          className="w-20 px-2 py-1 text-sm border border-neutral-200 rounded-md focus:outline-none focus:border-[var(--primary-400)]"
                        />
                        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
                          {(['seconds', 'minutes', 'hours'] as const).map((unit) => {
                            const active = customIntervalUnit === unit;
                            const labels = {
                              seconds: t('settings.automation.seconds_unit'),
                              minutes: t('settings.automation.minutes_unit'),
                              hours: t('settings.automation.hours_unit'),
                            };
                            return (
                              <button
                                key={unit}
                                type="button"
                                onClick={() => setCustomIntervalUnit(unit)}
                                className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                                  active
                                    ? 'bg-white text-[var(--primary-600)] shadow-sm'
                                    : 'text-neutral-500 hover:text-neutral-800'
                                }`}
                              >
                                {labels[unit]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </SettingRow>
                  )}

                  {selectedTemplate.jobType === 'cron' && (
                    <SettingRow
                      title={t('settings.automation.cron_expression')}
                      description={t('settings.automation.cron_expression_desc')}
                    >
                      <input
                        type="text"
                        value={customCron}
                        onChange={(e) => setCustomCron(e.target.value)}
                        placeholder="0 9 * * *"
                        className="w-36 px-2 py-1 text-sm font-mono border border-neutral-200 rounded-md focus:outline-none focus:border-[var(--primary-400)]"
                      />
                    </SettingRow>
                  )}
                </div>
              )}
            </div>

            {selectedTemplate && (
              <div className="px-6 py-4 border-t border-neutral-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedTemplate(null)}
                  className="px-4 py-1.5 text-sm font-medium text-neutral-600 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors"
                >
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  onClick={handleCreateJob}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-[var(--primary-500)] rounded-lg hover:bg-[var(--primary-600)] transition-colors"
                >
                  {t('settings.automation.create_task')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AutomationPage;
