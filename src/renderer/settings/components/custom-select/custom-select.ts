/**
 * 通用自定义下拉组件
 * 用于替换原生 <select>，实现统一的 UI 风格和"吸连"效果
 */

export interface CustomSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface CustomSelectConfig {
  id: string;
  options: CustomSelectOption[];
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  className?: string;
}

export class CustomSelect {
  private container: HTMLElement;
  private trigger: HTMLButtonElement;
  private valueSpan: HTMLElement;
  private arrow: SVGElement;
  private panel: HTMLElement;
  private options: CustomSelectOption[];
  private currentValue: string;
  private isOpen: boolean = false;
  private onChange?: (value: string) => void;
  private documentClickHandler: (e: MouseEvent) => void;

  constructor(config: CustomSelectConfig) {
    this.options = config.options;
    this.currentValue = config.value ?? '';
    this.onChange = config.onChange;

    // 创建容器
    this.container = document.createElement('div');
    this.container.className = `custom-select${config.className ? ' ' + config.className : ''}`;
    this.container.id = config.id;

    // 创建触发按钮
    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'custom-select__trigger';
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');

    // 创建值显示
    this.valueSpan = document.createElement('span');
    this.valueSpan.className = 'custom-select__value';
    this.valueSpan.textContent = this.getCurrentLabel() || config.placeholder || '请选择';

    // 创建箭头
    this.arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.arrow.setAttribute('class', 'custom-select__arrow');
    this.arrow.setAttribute('width', '12');
    this.arrow.setAttribute('height', '12');
    this.arrow.setAttribute('viewBox', '0 0 12 12');
    this.arrow.setAttribute('fill', 'none');
    this.arrow.setAttribute('aria-hidden', 'true');
    const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrowPath.setAttribute('d', 'M3 4.5L6 7.5L9 4.5');
    arrowPath.setAttribute('stroke', 'currentColor');
    arrowPath.setAttribute('stroke-width', '1.5');
    arrowPath.setAttribute('stroke-linecap', 'round');
    arrowPath.setAttribute('stroke-linejoin', 'round');
    this.arrow.appendChild(arrowPath);

    // 组装触发按钮
    this.trigger.appendChild(this.valueSpan);
    this.trigger.appendChild(this.arrow);

    // 创建下拉面板
    this.panel = document.createElement('div');
    this.panel.className = 'custom-select__panel is-hidden';
    this.panel.setAttribute('role', 'listbox');

    // 渲染选项
    this.renderOptions();

    // 组装容器
    this.container.appendChild(this.trigger);
    this.container.appendChild(this.panel);

    // 绑定事件
    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.panel.addEventListener('click', (e) => {
      const option = (e.target as HTMLElement).closest<HTMLButtonElement>('.custom-select__option');
      if (!option || option.disabled) return;
      const value = option.dataset.value;
      if (value) {
        this.setValue(value);
        this.close();
      }
    });

    // 点击外部关闭
    this.documentClickHandler = (e: MouseEvent) => {
      if (!this.container.contains(e.target as Node)) {
        this.close();
      }
    };
    document.addEventListener('click', this.documentClickHandler);
  }

  private getCurrentLabel(): string {
    const option = this.options.find(o => o.value === this.currentValue);
    return option ? option.label : '';
  }

  private renderOptions(): void {
    this.panel.innerHTML = '';
    this.options.forEach(option => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'custom-select__option';
      btn.dataset.value = option.value;
      btn.textContent = option.label;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(option.value === this.currentValue));
      if (option.disabled) {
        btn.disabled = true;
        btn.classList.add('is-disabled');
      }
      if (option.value === this.currentValue) {
        btn.classList.add('is-selected');
      }
      this.panel.appendChild(btn);
    });
  }

  public toggle(open?: boolean): void {
    this.isOpen = open ?? !this.isOpen;
    this.panel.classList.toggle('is-hidden', !this.isOpen);
    this.trigger.setAttribute('aria-expanded', String(this.isOpen));
    this.trigger.classList.toggle('is-open', this.isOpen);
  }

  public open(): void {
    this.toggle(true);
  }

  public close(): void {
    this.toggle(false);
  }

  public getValue(): string {
    return this.currentValue;
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public setValue(value: string, triggerChange: boolean = true): void {
    this.currentValue = value;
    this.valueSpan.textContent = this.getCurrentLabel();
    this.renderOptions();
    if (triggerChange && this.onChange) {
      this.onChange(value);
    }
  }

  public setOptions(options: CustomSelectOption[]): void {
    this.options = options;
    this.renderOptions();
    // 如果当前值不在新选项中，清空
    if (!options.find(o => o.value === this.currentValue)) {
      this.currentValue = '';
      this.valueSpan.textContent = '请选择';
    }
  }

  public destroy(): void {
    document.removeEventListener('click', this.documentClickHandler);
    this.container.remove();
  }

  /**
   * 从原生 <select> 元素创建 CustomSelect
   */
  public static fromNativeSelect(
    nativeSelect: HTMLSelectElement,
    onChange?: (value: string) => void
  ): CustomSelect {
    const options: CustomSelectOption[] = [];
    Array.from(nativeSelect.options).forEach(opt => {
      options.push({
        value: opt.value,
        label: opt.textContent || opt.value,
        disabled: opt.disabled
      });
    });

    const config: CustomSelectConfig = {
      id: nativeSelect.id || `custom-select-${Date.now()}`,
      options,
      value: nativeSelect.value,
      onChange
    };

    const customSelect = new CustomSelect(config);

    // 替换原生元素
    nativeSelect.parentNode?.replaceChild(customSelect.getElement(), nativeSelect);

    return customSelect;
  }

  /**
   * 包装原生 <select> 元素（不替换，而是隐藏原生元素并在旁边插入自定义组件）
   * 当用户选择自定义组件的选项时，同步更新原生 select 的值并触发 change 事件
   * 这样现有的事件监听和保存逻辑都不需要修改
   */
  public static wrapNativeSelect(
    nativeSelect: HTMLSelectElement
  ): CustomSelect {
    const options: CustomSelectOption[] = [];
    Array.from(nativeSelect.options).forEach(opt => {
      options.push({
        value: opt.value,
        label: opt.textContent || opt.value,
        disabled: opt.disabled
      });
    });

    const config: CustomSelectConfig = {
      id: nativeSelect.id ? `${nativeSelect.id}-custom` : `custom-select-${Date.now()}`,
      options,
      value: nativeSelect.value,
      onChange: (value) => {
        // 同步更新原生 select 的值
        nativeSelect.value = value;
        // 触发原生 select 的 change 事件
        nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };

    const customSelect = new CustomSelect(config);

    // 隐藏原生 select 元素
    nativeSelect.style.display = 'none';

    // 在原生 select 元素旁边插入自定义组件
    nativeSelect.parentNode?.insertBefore(customSelect.getElement(), nativeSelect.nextSibling);

    // 监听原生 select 的值变化（比如通过代码设置值时），同步更新自定义组件
    const observer = new MutationObserver(() => {
      if (nativeSelect.value !== customSelect.getValue()) {
        customSelect.setValue(nativeSelect.value, false);
      }
    });
    observer.observe(nativeSelect, { attributes: true, attributeFilter: ['value'] });

    return customSelect;
  }

  /**
   * 批量包装所有带指定类名的 select 元素
   */
  public static wrapAll(selector: string = 'select.setting-select'): CustomSelect[] {
    const selects = document.querySelectorAll<HTMLSelectElement>(selector);
    const customSelects: CustomSelect[] = [];
    selects.forEach((select) => {
      try {
        const customSelect = CustomSelect.wrapNativeSelect(select);
        customSelects.push(customSelect);
      } catch (error) {
        console.error('[CustomSelect] 包装失败:', error);
      }
    });
    console.log(`[CustomSelect] 已包装 ${customSelects.length} 个 select 元素`);
    return customSelects;
  }
}
