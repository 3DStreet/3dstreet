import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import {
  isSectionCollapsed,
  setSectionCollapsed,
  onCollapseAll,
  broadcastCollapseAll
} from '../lib/panelPrefs';

export default class Collapsible extends React.Component {
  static propTypes = {
    className: PropTypes.string,
    collapsed: PropTypes.bool,
    children: PropTypes.oneOfType([PropTypes.array, PropTypes.element])
      .isRequired,
    id: PropTypes.string,
    // Named sections (#1981) remember their collapsed state per device: the
    // preference is keyed by this string (shared across entities — collapsing
    // "Transform" on one entity collapses it for every entity), and
    // shift-clicking a header applies the toggle to every named section
    // currently in view.
    sectionKey: PropTypes.string
  };

  static defaultProps = {
    collapsed: false
  };

  constructor(props) {
    super(props);
    this.state = {
      collapsed: props.sectionKey
        ? isSectionCollapsed(props.sectionKey, props.collapsed)
        : props.collapsed
    };
  }

  componentDidMount() {
    if (this.props.sectionKey) {
      this.offCollapseAll = onCollapseAll(this.onCollapseAll);
    }
  }

  componentWillUnmount() {
    this.offCollapseAll?.();
  }

  componentDidUpdate(prevProps) {
    // React reuses instances across renders; if this slot starts showing a
    // different named section, pick up that section's stored preference.
    if (prevProps.sectionKey !== this.props.sectionKey) {
      this.setState({
        collapsed: this.props.sectionKey
          ? isSectionCollapsed(this.props.sectionKey, this.props.collapsed)
          : this.props.collapsed
      });
      this.offCollapseAll?.();
      this.offCollapseAll = this.props.sectionKey
        ? onCollapseAll(this.onCollapseAll)
        : undefined;
    }
  }

  onCollapseAll = (collapsed) => {
    setSectionCollapsed(this.props.sectionKey, collapsed);
    this.setState({ collapsed });
  };

  toggleVisibility = (event) => {
    // Don't collapse if we click on actions like clipboard
    if (event.target.nodeName === 'A') return;
    const collapsed = !this.state.collapsed;
    if (this.props.sectionKey) {
      if (event.shiftKey) {
        // Applies to every named section in the current view, this one
        // included (each subscriber persists its own key).
        broadcastCollapseAll(collapsed);
        return;
      }
      setSectionCollapsed(this.props.sectionKey, collapsed);
    }
    this.setState({ collapsed });
  };

  render() {
    const rootClassNames = {
      collapsible: true,
      component: true,
      collapsed: this.state.collapsed
    };
    if (this.props.className) {
      rootClassNames[this.props.className] = true;
    }
    const rootClasses = classNames(rootClassNames);

    const contentClasses = classNames({
      content: true,
      hide: this.state.collapsed
    });

    return (
      <div id={this.props.id} className={rootClasses}>
        <div className="static" onClick={this.toggleVisibility}>
          <div className="collapse-button" />
          {this.props.children[0]}
        </div>
        <div className={contentClasses}>{this.props.children[1]}</div>
      </div>
    );
  }
}
