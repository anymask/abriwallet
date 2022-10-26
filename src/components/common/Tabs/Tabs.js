import cn from 'classnames'
import { useState } from 'react'
import Panel from 'components/common/Panel/Panel'
import styles from './Tabs.module.scss'

const Tabs = ({ 
  firstTabLabel, 
  secondTabLabel,
  firstTab,
  secondTab,
  panelClassName,
  tabClassName,
  footer,
  defaultTab
}) => {
  const [currentTab, setCurrentTab] = useState(defaultTab || 1)

  const handleOpenFirst = () => setCurrentTab(1)
  const handleOpenSecond = () => setCurrentTab(2)

  return (
    <Panel className={cn(styles.panel, panelClassName)}>
      <div className={styles.tabs}>
        <button 
          onClick={handleOpenFirst}
          className={cn(styles.tabsButton, tabClassName, {[styles.active]: currentTab === 1})}
        >
          {firstTabLabel}
        </button>
        <button 
          onClick={handleOpenSecond}
          className={cn(styles.tabsButton, tabClassName, {[styles.active]: currentTab === 2})}
        >
          {secondTabLabel}
        </button>
        <div className={styles.shadow}></div>
      </div>
      {currentTab === 1 ? firstTab : secondTab}
      {footer}
    </Panel>
  )
}

export default Tabs