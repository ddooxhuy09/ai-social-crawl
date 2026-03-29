import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-left bg-red-50 text-red-900 border border-red-200 m-8 rounded-lg overflow-auto">
          <h2 className="text-2xl font-bold mb-4">React Error in Project Page</h2>
          <p className="font-semibold mb-2">{this.state.error && this.state.error.toString()}</p>
          <pre className="text-xs bg-red-100 p-4 rounded whitespace-pre-wrap">
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
