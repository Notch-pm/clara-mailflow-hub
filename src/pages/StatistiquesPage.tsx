import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessStats } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Mail, Send, Clock } from "lucide-react";
import { listServices } from "@/services/orgServiceService";
import {
  getInboundByMonth,
  getInboundByDay,
  getTagEvolution,
  getByChannel,
  getByService,
  getRepliesByMonth,
  getProcessingTimes,
  getUsagersByQuartier,
} from "@/services/statsService";
import { StatsFilters, type StatPeriod } from "@/components/stats/StatsFilters";
import { InboundVolumeChart } from "@/components/stats/charts/InboundVolumeChart";
import { InboundDailyChart } from "@/components/stats/charts/InboundDailyChart";
import { TagEvolutionChart } from "@/components/stats/charts/TagEvolutionChart";
import { ByChannelChart } from "@/components/stats/charts/ByChannelChart";
import { ByServiceChart } from "@/components/stats/charts/ByServiceChart";
import { RepliesChart } from "@/components/stats/charts/RepliesChart";
import { ProcessingTimesChart } from "@/components/stats/charts/ProcessingTimesChart";
import { UsagersByQuartierChart } from "@/components/stats/charts/UsagersByQuartierChart";

function sinceFromPeriod(period: StatPeriod): Date {
  const d = new Date();
  if (period === "7d") d.setDate(d.getDate() - 7);
  else if (period === "30d") d.setDate(d.getDate() - 30);
  else d.setFullYear(d.getFullYear() - 1);
  return d;
}

interface KpiCardProps {
  label: string;
  value: number | undefined;
  loading: boolean;
  Icon: React.ElementType;
  iconColor: string;
}

function KpiCard({ label, value, loading, Icon, iconColor }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-5 pb-5">
        <div className={`rounded-xl p-2.5 bg-muted ${iconColor}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          {loading ? (
            <Skeleton className="h-7 w-16 mt-0.5" />
          ) : (
            <p className="text-2xl font-bold text-foreground">{value ?? 0}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function StatistiquesPage() {
  const { organizationId } = useOrganization();
  const { profile, membership } = useAuth();
  const allowed = canAccessStats(profile, membership);
  const [serviceName, setServiceName] = useState<string | null>(null);
  const [period, setPeriod] = useState<StatPeriod>("30d");

  const since = useMemo(() => sinceFromPeriod(period), [period]);
  const sinceISO = since.toISOString();

  const enabled = !!organizationId;

  const { data: services = [] } = useQuery({
    queryKey: ["services", organizationId],
    queryFn: () => listServices(organizationId!),
    enabled,
  });

  const { data: monthlyData, isLoading: loadingMonthly } = useQuery({
    queryKey: ["stats-inbound-month", organizationId, serviceName],
    queryFn: () => getInboundByMonth(organizationId!, 12, serviceName ?? undefined),
    enabled,
  });

  const { data: dailyData, isLoading: loadingDaily } = useQuery({
    queryKey: ["stats-inbound-day", organizationId, serviceName],
    queryFn: () => getInboundByDay(organizationId!, serviceName ?? undefined),
    enabled,
  });

  const { data: tagData, isLoading: loadingTags } = useQuery({
    queryKey: ["stats-tags", organizationId, serviceName, sinceISO],
    queryFn: () => getTagEvolution(organizationId!, since, serviceName ?? undefined),
    enabled,
  });

  const { data: channelData, isLoading: loadingChannel } = useQuery({
    queryKey: ["stats-channel", organizationId, serviceName, sinceISO],
    queryFn: () => getByChannel(organizationId!, since, serviceName ?? undefined),
    enabled,
  });

  const { data: inboundByService, isLoading: loadingInboundService } = useQuery({
    queryKey: ["stats-inbound-service", organizationId, sinceISO],
    queryFn: () => getByService(organizationId!, "inbound", since),
    enabled,
  });

  const { data: outboundByService, isLoading: loadingOutboundService } = useQuery({
    queryKey: ["stats-outbound-service", organizationId, sinceISO],
    queryFn: () => getByService(organizationId!, "outbound", since),
    enabled,
  });

  const { data: repliesData, isLoading: loadingReplies } = useQuery({
    queryKey: ["stats-replies", organizationId, serviceName],
    queryFn: () => getRepliesByMonth(organizationId!, 12, serviceName ?? undefined),
    enabled,
  });

  const { data: processingData, isLoading: loadingProcessing } = useQuery({
    queryKey: ["stats-processing", organizationId, sinceISO],
    queryFn: () => getProcessingTimes(organizationId!, since),
    enabled,
  });

  const { data: quartierData, isLoading: loadingQuartiers } = useQuery({
    queryKey: ["stats-quartiers", organizationId],
    queryFn: () => getUsagersByQuartier(organizationId!),
    enabled,
  });

  const totalInbound = useMemo(
    () => (monthlyData ?? []).reduce((s, d) => s + d.count, 0),
    [monthlyData],
  );
  const totalOutbound = useMemo(
    () => (outboundByService ?? []).reduce((s, d) => s + d.count, 0),
    [outboundByService],
  );
  const totalReplies = useMemo(
    () => (repliesData ?? []).reduce((s, d) => s + d.count, 0),
    [repliesData],
  );

  if (!allowed) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-bold text-foreground">Statistiques</h1>
      </div>

      <StatsFilters
        services={services.map((s) => ({ id: s.id, name: s.name }))}
        serviceName={serviceName}
        period={period}
        onServiceChange={setServiceName}
        onPeriodChange={setPeriod}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          label="Courriers entrants (12 mois)"
          value={totalInbound}
          loading={loadingMonthly}
          Icon={Mail}
          iconColor="text-primary"
        />
        <KpiCard
          label="Courriers sortants (période)"
          value={totalOutbound}
          loading={loadingOutboundService}
          Icon={Send}
          iconColor="text-blue-500"
        />
        <KpiCard
          label="Réponses émises (12 mois)"
          value={totalReplies}
          loading={loadingReplies}
          Icon={Clock}
          iconColor="text-amber-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <InboundVolumeChart data={monthlyData} loading={loadingMonthly} />
        <InboundDailyChart data={dailyData} loading={loadingDaily} />
        <TagEvolutionChart data={tagData} loading={loadingTags} />
        <ByChannelChart data={channelData} loading={loadingChannel} />
        <RepliesChart data={repliesData} loading={loadingReplies} />
        <ByServiceChart data={inboundByService} loading={loadingInboundService} direction="inbound" />
        <ByServiceChart data={outboundByService} loading={loadingOutboundService} direction="outbound" />
        <ProcessingTimesChart data={processingData} loading={loadingProcessing} />
        <UsagersByQuartierChart data={quartierData} loading={loadingQuartiers} />
      </div>
    </div>
  );
}
