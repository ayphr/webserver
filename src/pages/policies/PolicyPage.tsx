import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, CardHeader } from '../../components/common';
import { Markdown } from '../../../common';
import { MarkdownRenderer } from '../../lib/markdown';
import './Policies.css';

interface PolicyContent {
  content: string;
  updated_date_formatted: string;
}

interface PolicyPageProps {
  title: string;
  policyKey: 'tos' | 'privacy' | 'refund';
}

export const PolicyPage = ({ title, policyKey }: PolicyPageProps) => {
  const [policy, setPolicy] = useState<PolicyContent | null>(null);
  const [loading, setLoading] = useState(true);

  const markdown = useMemo(() => new Markdown(policy?.content ?? '', true), [policy]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('https://raw.githubusercontent.com/ayphr/policies-static/refs/heads/main/versions.json');
        const data = await res.json();
        setPolicy(data.policies[policyKey]);
      } catch (err) {
        console.error(`Failed to load ${policyKey} policy:`, err);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [policyKey]);

  return (
    <div className="policies-page">
      <div className="policies-container policies-container--wide">
        <Card elevated className="policies-card">
          <CardHeader>
            <h1>{title}</h1>
            {policy && <p>Last updated: {policy.updated_date_formatted}</p>}
          </CardHeader>
          <CardBody>
            {loading ? (
              <p>Loading...</p>
            ) : (
              <div className="policies-content">
                <MarkdownRenderer markdown={markdown} features={['bold', 'italic', 'strike', 'code', 'codeBlock', 'lists', 'headings']} />
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};
