import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { Section, Switch, Modal, useToast, useConfirm } from '../../components';
import {
  initMcpStorage,
  getMcpServers,
  addMcpServer,
  updateMcpServer,
  removeMcpServer,
  connectServer,
  disconnectServer,
  getServerStatus,
  generateMcpId,
} from '../../../services/mcp/manager';
import { setPendingPluginTab, emitPluginTabSwitch } from '../extensions/pluginNav';
import type { McpServerConfig, McpServerStatus } from '../../../services/mcp/types';

/** 编辑表单数据 */
interface EditForm {
  id?: string;
  name: string;
  command: string;
  args: string;
  enabled: boolean;
}

const EMPTY_FORM: EditForm = {
  name: '',
  command: '',
  args: '',
  enabled: true,
};

export function McpPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statuses, setStatuses] = useState<Map<string, McpServerStatus>>(new Map());
  const [modalOpen, setModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_FORM);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadServers = useCallback(async () => {
    await initMcpStorage();
    const list = getMcpServers();
    setServers(list);
    // 加载运行时状态
    const statusMap = new Map<string, McpServerStatus>();
    for (const s of list) {
      statusMap.set(s.id, getServerStatus(s.id));
    }
    setStatuses(statusMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  // 定时刷新状态（每 2 秒）
  useEffect(() => {
    const timer = setInterval(() => {
      const statusMap = new Map<string, McpServerStatus>();
      for (const s of servers) {
        statusMap.set(s.id, getServerStatus(s.id));
      }
      setStatuses(statusMap);
    }, 2000);
    return () => clearInterval(timer);
  }, [servers]);

  const handleAdd = () => {
    setEditForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const handleEdit = (server: McpServerConfig) => {
    setEditForm({
      id: server.id,
      name: server.name,
      command: server.command,
      args: server.args.join(' '),
      enabled: server.enabled,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    // 验证
    if (!editForm.name.trim()) {
      showToast(t('settings.mcp.validation_name'), 'warning');
      return;
    }
    if (!editForm.command.trim()) {
      showToast(t('settings.mcp.validation_command'), 'warning');
      return;
    }

    const args = editForm.args.trim().split(/\s+/).filter(Boolean);
    if (editForm.id) {
      // 编辑
      updateMcpServer(editForm.id, {
        name: editForm.name.trim(),
        command: editForm.command.trim(),
        args,
        enabled: editForm.enabled,
      });
      showToast(t('settings.mcp.updated'), 'success');
    } else {
      // 新增
      addMcpServer({
        id: generateMcpId(),
        name: editForm.name.trim(),
        command: editForm.command.trim(),
        args,
        enabled: editForm.enabled,
      });
      showToast(t('settings.mcp.added'), 'success');
    }
    setModalOpen(false);
    await loadServers();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm(t('settings.mcp.confirm_delete')))) return;
    removeMcpServer(id);
    showToast(t('settings.mcp.deleted'), 'success');
    await loadServers();
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    updateMcpServer(id, { enabled });
    await loadServers();
  };

  const handleConnect = async (server: McpServerConfig) => {
    try {
      await connectServer(server);
      showToast(t('settings.mcp.connected', { name: server.name }), 'success');
      await loadServers();
    } catch (err) {
      showToast(t('settings.mcp.connect_failed', { error: String(err) }), 'error');
    }
  };

  const handleDisconnect = async (id: string) => {
    await disconnectServer(id);
    showToast(t('settings.mcp.disconnected'), 'success');
    await loadServers();
  };

  const statusColor = (status: string): string => {
    switch (status) {
      case 'connected':
        return 'text-green-600 bg-green-50';
      case 'connecting':
        return 'text-amber-600 bg-amber-50';
      case 'error':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-neutral-500 bg-neutral-50';
    }
  };

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center py-12 text-neutral-400 text-sm">
        <Icon icon="solar:restart-bold" className="animate-spin mr-2 text-base" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section title={t('settings.mcp.section_title')} description={t('settings.mcp.section_desc')}>
        <div className="p-4">
          {servers.length === 0 ? (
            <div className="text-center py-12">
              <Icon
                icon="solar:server-square-cloud-bold-duotone"
                className="text-4xl text-neutral-300 mx-auto mb-3"
              />
              <div className="text-sm text-neutral-400">{t('settings.mcp.empty')}</div>
            </div>
          ) : (
            <div className="grid gap-2">
              {servers.map((server) => {
                const status = statuses.get(server.id);
                const statusText = status?.status ?? 'disconnected';
                const tools = status?.tools ?? [];
                const isExpanded = expandedId === server.id;

                return (
                  <div
                    key={server.id}
                    className="rounded-xl border border-neutral-200 bg-white overflow-hidden"
                  >
                    <div className="p-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span
                          className={`px-2 py-0.5 rounded-md text-xs font-medium ${statusColor(statusText)}`}
                        >
                          {t(`settings.mcp.status_${statusText}`)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-neutral-800 truncate">
                            {server.name}
                          </div>
                          <div className="text-xs text-neutral-400 font-mono truncate">
                            {server.command} {server.args.join(' ')}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* 连接/断开按钮 */}
                        {statusText === 'connected' ? (
                          <button
                            type="button"
                            onClick={() => handleDisconnect(server.id)}
                            className="px-2.5 py-1 rounded-lg bg-neutral-100 text-neutral-600 text-xs hover:bg-neutral-200 transition-colors"
                          >
                            {t('settings.mcp.disconnect')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleConnect(server)}
                            disabled={!server.enabled || statusText === 'connecting'}
                            className="px-2.5 py-1 rounded-lg bg-[var(--primary-500)] text-white text-xs hover:bg-[var(--primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {statusText === 'connecting'
                              ? t('settings.mcp.connecting')
                              : t('settings.mcp.connect')}
                          </button>
                        )}

                        {/* 工具列表展开按钮 */}
                        {tools.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : server.id)}
                            className="p-1 rounded-lg text-neutral-400 hover:bg-neutral-100 transition-colors"
                            title={t('settings.mcp.toggle_tools')}
                          >
                            <Icon
                              icon={
                                isExpanded ? 'solar:alt-arrow-up-bold' : 'solar:alt-arrow-down-bold'
                              }
                              className="text-sm"
                            />
                          </button>
                        )}

                        {/* 编辑按钮 */}
                        <button
                          type="button"
                          onClick={() => handleEdit(server)}
                          className="p-1 rounded-lg text-neutral-400 hover:bg-neutral-100 transition-colors"
                          title={t('settings.mcp.edit')}
                        >
                          <Icon icon="solar:pen-bold" className="text-sm" />
                        </button>

                        {/* 删除按钮 */}
                        <button
                          type="button"
                          onClick={() => handleDelete(server.id)}
                          className="p-1 rounded-lg text-neutral-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                          title={t('settings.mcp.delete')}
                        >
                          <Icon icon="solar:trash-bin-trash-bold" className="text-sm" />
                        </button>

                        {/* 启用开关 */}
                        <Switch
                          checked={server.enabled}
                          onChange={() => handleToggleEnabled(server.id, !server.enabled)}
                        />
                      </div>
                    </div>

                    {/* 错误信息 */}
                    {status?.error && (
                      <div className="px-3 pb-2 text-xs text-red-500">{status.error}</div>
                    )}

                    {/* 工具列表 */}
                    {isExpanded && tools.length > 0 && (
                      <div className="px-3 pb-3 border-t border-neutral-100 pt-2">
                        <div className="text-xs text-neutral-400 mb-1.5">
                          {t('settings.mcp.tools_count', { count: tools.length })}
                        </div>
                        <div className="grid gap-1">
                          {tools.map((tool) => (
                            <div
                              key={tool.name}
                              className="px-2 py-1.5 rounded-lg bg-neutral-50 text-xs"
                            >
                              <div className="font-medium text-neutral-700">{tool.name}</div>
                              {tool.description && (
                                <div className="text-neutral-400 mt-0.5">{tool.description}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 添加按钮 */}
          <button
            type="button"
            onClick={handleAdd}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 py-2.5 text-sm text-neutral-500 hover:border-[var(--primary-400)] hover:text-[var(--primary-500)] transition-colors"
          >
            <Icon icon="solar:add-circle-bold" className="text-base" />
            {t('settings.mcp.add_button')}
          </button>

          {/* 市场预设入口 */}
          <button
            type="button"
            onClick={() => {
              setPendingPluginTab('market');
              emitPluginTabSwitch('market');
              navigate('/settings/extensions/plugins', { replace: true });
            }}
            className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--primary-200)] bg-[var(--primary-50)] py-2.5 text-sm text-[var(--primary-600)] hover:bg-[var(--primary-100)] transition-colors"
          >
            <Icon icon="solar:shop-bold-duotone" className="text-base" />
            {t('settings.mcp.market_button')}
          </button>
        </div>
      </Section>

      {/* 添加/编辑 Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editForm.id ? t('settings.mcp.edit_title') : t('settings.mcp.add_title')}
        footer={
          <>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-[var(--primary-500)] text-white text-sm hover:bg-[var(--primary-600)] transition-colors"
            >
              {t('common.save')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              {t('settings.mcp.field_name')}
            </label>
            <input
              type="text"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              placeholder={t('settings.mcp.field_name_placeholder')}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm focus:outline-none focus:border-[var(--primary-500)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              {t('settings.mcp.field_command')}
            </label>
            <input
              type="text"
              value={editForm.command}
              onChange={(e) => setEditForm({ ...editForm, command: e.target.value })}
              placeholder={t('settings.mcp.field_command_placeholder')}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm font-mono focus:outline-none focus:border-[var(--primary-500)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              {t('settings.mcp.field_args')}
            </label>
            <input
              type="text"
              value={editForm.args}
              onChange={(e) => setEditForm({ ...editForm, args: e.target.value })}
              placeholder={t('settings.mcp.field_args_placeholder')}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm font-mono focus:outline-none focus:border-[var(--primary-500)]"
            />
            <div className="text-xs text-neutral-400 mt-1">{t('settings.mcp.field_args_tip')}</div>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-neutral-50">
            <div>
              <div className="text-sm font-medium text-neutral-700">
                {t('settings.mcp.field_enabled')}
              </div>
              <div className="text-xs text-neutral-400">{t('settings.mcp.field_enabled_desc')}</div>
            </div>
            <Switch
              checked={editForm.enabled}
              onChange={() => setEditForm({ ...editForm, enabled: !editForm.enabled })}
            />
          </div>
        </div>
      </Modal>

      {/* 说明 */}
      <div className="mt-4 p-3 rounded-lg bg-neutral-50 border border-neutral-100">
        <div className="flex items-start gap-2">
          <Icon
            icon="solar:info-circle-bold-duotone"
            className="text-base text-neutral-400 shrink-0 mt-0.5"
          />
          <div className="text-xs text-neutral-500 leading-relaxed">{t('settings.mcp.tip')}</div>
        </div>
      </div>
    </div>
  );
}

export default McpPage;
